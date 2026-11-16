# Client campaigns: sending

Client campaigns PR 3 (ClickUp `z8rp3ff7x6`). It builds on PR 1 (templates, add-on settings) and PR 2 (client sources). **It ships together with PR 4 (reply handling).** No real client should get a campaign until replies are handled.

## Flow

1. **Draft** (`/campaigns/new`): name, approved template, audience, a value for each template variable, goal, optional brief, optional batch size, optional send time, optional sending hours.
2. **Check** (`POST /api/campaigns/runs/[id]/preview`): who gets it after the skip rules, skip counts by reason, a sample, the estimated Meta cost and the message preview. Nothing is written.
3. **Confirm** (`POST /api/campaigns/runs/[id]/confirm`): the owner ticks the declaration. In one transaction the campaign stores `OwnerDeclaration` (text as shown, language, `DECLARATION_VERSION`, actor, recipient count), moves to `scheduled`, and writes one `CampaignSend` per recipient. No phone, an invalid phone, or an empty template value is a skipped row. Everyone else is queued. An audience over 20,000 is refused and the campaign stays a draft. Without the declaration, nothing is sent.
4. **Send:**
   - `campaigns-tick` (every 5 minutes) queues `campaigns/run.requested` for each campaign that is due. Confirm and resume send that same event id for the current 5-minute slot, so a tick in the same window does not start a second run. Anything still queued waits for the next slot.
   - `campaign-run` runs one tenant at a time. It does not rebuild the audience once `materializedAt` is set. A campaign confirmed before rows were frozen still gets them on its first run.
   - Each chunk is a durable step. Inside it, every queued row is checked against the skip rules again. If the campaign is no longer `sending`, the rest stay queued. Otherwise the row is claimed (`queued → sending`), sent through Zernio from the template's account, and marked `sent` (with `sentAt`) or `failed`.

## Rules (`src/lib/campaigns/rules.ts`)

- **One message per person per campaign:** `CampaignSend` is unique on campaign + phone. A row left in `sending` does not count toward the 7-day cap, the daily ceiling, or the batch. If it is still `sending` after 15 minutes, the next run queues it again. That can send twice when Zernio already accepted the message and the process died before the `sent` write.
- **Skips:**
  - no or invalid phone (a WhatsApp id is used when it is a usable number; otherwise the lead's phone field, normalized as an Israeli number)
  - suppressed (opted out)
  - not on the allow-list
  - got another campaign in the last 7 days (`sent` rows only)
  - open conversation in the last 3 days
  - open task or upcoming request
  - lead marked lost or not relevant
  - archived client (the connector's `archivedField`), checked again at send time
  - a template value would be empty
- **Sending hours** in the tenant's timezone. The default is Sunday to Thursday 09:00-20:00, Friday 09:00-14:00, never on Saturday. A draft can store its own `startHour`, `endHour`, `fridayEndHour` and `saturdayClosed`. Null uses the default. Outside the window the campaign waits. It is not paused.
- **Budget:** the smallest of:
  - the tenant's daily ceiling, counting `sent` rows from every campaign today
  - what is left of the batch, counting `sent` rows
  - the tenant's sends per run (default 300, at most 1000)

  The pause between two sends is the tenant's `sendGapMs` (default 250, allowed 0-5000). The campaign stores how long the last run took, including those pauses.

  When the batch is used up, the campaign pauses (`batch_done`) until the owner resumes it. Resume starts a new batch from the current sent count and kicks a run when the campaign is due.
- **Template:** its status is re-read from Meta before each run. If it is no longer approved, the campaign pauses.
- **Allow-list:** always on outside production. In production it applies only while `CAMPAIGN_ALLOWLIST_ONLY=1`.
- **Local dev:** when Zernio is not configured, outside production, sends are recorded as `sent` with `error: "dry_run"`.

Status changes during a run (`pause`, `cancel`, the move to `sending` or `done`) match on `scheduled` or `sending`. A cancel or pause that lands first is not overwritten.

## Screens

- `/campaigns`: campaigns list (default) and the templates tab from PR 1.
- `/campaigns/[id]`: the editor and confirm step while a draft. After that: status, why it paused or is waiting, pause / resume / cancel, counts, skip reasons and recipients.
- Leads page: with campaigns on, an owner or admin sees "Send campaign" for the selected leads.
- Lead timeline: shows each campaign template sent to that lead.
