# Client campaigns: sending

Client campaigns PR 3 (ClickUp `z8rp3ff7x6`). It builds on PR 1 (templates, add-on settings) and PR 2 (client sources). **It ships together with PR 4 (reply handling).** No real client should get a campaign until replies are handled.

## Flow

1. **Draft** (`/campaigns/new`): name, approved template, audience, a value for each template variable, goal, optional brief, optional batch size, optional send time.
2. **Check** (`POST /api/campaigns/runs/[id]/preview`): who gets it after the skip rules, skip counts by reason, a sample, the estimated Meta cost and the message preview. Nothing is written.
3. **Confirm** (`POST /api/campaigns/runs/[id]/confirm`): the owner ticks the declaration. `OwnerDeclaration` (text as shown, language, `DECLARATION_VERSION`, actor, recipient count) and the status change to `scheduled` are written in one transaction. Without it, nothing is sent.
4. **Send:**
   - `campaigns-tick` (every 5 minutes) queues `campaigns/run.requested` for each campaign that is due.
   - `campaign-run` runs one tenant at a time. On its first run it turns the audience into `CampaignSend` rows (queued, or skipped with a reason).
   - Each chunk is a durable step. Inside it, every row is checked against the skip rules again, claimed (`queued → sending`), sent through Zernio from the template's account, and marked `sent` or `failed`.

## Rules (`src/lib/campaigns/rules.ts`)

- **One message per person per campaign:** `CampaignSend` is unique on campaign + phone. A row left in `sending` (a crash mid-send) is never sent again.
- **Skips:**
  - no or invalid phone
  - suppressed (opted out)
  - not on the allow-list
  - got another campaign in the last 7 days
  - open conversation in the last 3 days
  - open task or upcoming request
  - lead marked lost or not relevant
  - archived client (the connector's `archivedField`)
  - a template value would be empty
- **Sending hours** in the tenant's timezone: Sunday to Thursday 09:00-20:00, Friday 09:00-14:00, never on Saturday. Outside these hours the campaign waits. It is not paused.
- **Budget:** the smallest of:
  - the tenant's daily ceiling, counting sends from every campaign today
  - what is left of the batch
  - 300 per run

  When the batch is used up, the campaign pauses (`batch_done`) until the owner resumes it.
- **Template:** its status is re-read from Meta before each run. If it is no longer approved, the campaign pauses.
- **Allow-list:** always on outside production. In production it applies only while `CAMPAIGN_ALLOWLIST_ONLY=1`.
- **Local dev:** when Zernio is not configured, outside production, sends are recorded as `sent` with `error: "dry_run"`.

## Screens

- `/campaigns`: campaigns list (default) and the templates tab from PR 1.
- `/campaigns/[id]`: the editor and confirm step while a draft. After that: status, why it paused or is waiting, pause / resume / cancel, counts, skip reasons and recipients.
- Leads page: with campaigns on, an owner or admin sees "Send campaign" for the selected leads.
- Lead timeline: shows each campaign template sent to that lead.
