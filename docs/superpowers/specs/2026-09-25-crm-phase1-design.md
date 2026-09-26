# CRM phase 1: follow-up queue and automatic pipeline

Status: approved design, 2026-09-25. Next step: implementation plan.
Mockup: https://claude.ai/artifact/UYBTMW7zhfPTRsjsA6F288 (clickable; main's palette, new components, larger type).
Later phases: [`docs/crm-backlog.md`](../../crm-backlog.md). Not specced here.

## 1. Brief

**Goal.** Turn פניות (`/leads`) from a flat table into a working CRM for small businesses that sell on WhatsApp and Instagram.

**Who.** Owners with a team of 1 to 3 people (villas, clinics, beauty, event halls, shops), often on a phone. The bot handles the first contact and the nudges. The CRM starts where the bot stops.

**Jobs, in priority order (set by the product owner):**
1. **Follow-up.** Show clearly which leads need the business to act, and why.
2. **Pipeline visibility.** Show each lead's stage and intent, and what is pending.

**Success.**
- The owner opens one tab and sees every lead that needs them, most urgent first.
- Stages are correct without anyone updating them by hand, and the owner can still override any stage.
- The owner hears about waiting leads without opening the app (a daily WhatsApp digest).
- The UI meets the quality bar in section 7, which is higher than the current screens.

**Out of scope for phase 1:** deal value, team assignment, reports, lead source and attribution, retention flows, instant alerts. All of these are in the backlog doc.

## 2. Decisions log

| Topic | Decision |
|---|---|
| Who moves stages | Automatic from signals, with a manual override that always works |
| Stage set | Fixed ids for every tenant; labels vary by vertical |
| Follow-up reasons | `handoff`, `approval`, `reminder`, `cold` (the 5th reason, `unanswered`, was rejected) |
| Cold threshold | 20h after our last message (leaves about 4h of the WhatsApp 24h window) |
| Main screen | Smart list with tabs and a pipeline strip (no kanban) |
| Inbox vs CRM | Inbox is where the owner acts on tasks; the CRM tracks leads and links into the Inbox |
| Extra lead data | Next step with a due date, internal notes, activity timeline. No deal value |
| Architecture | Option C (hybrid): a pure derive function, persisted columns, one writer, a stage history table |
| Owner notification | Daily digest, WhatsApp only, behind a feature flag, sent from a number the product owner supplies |
| Palette | Keep main's current palette (WhatsApp green tokens in `globals.css`). Change components, layout and type size |

## 3. Pipeline stages

### 3.1 Stages

| id | Meaning |
|---|---|
| `new` | Lead has messaged; nothing is known yet |
| `talking` | Engaged; intent is known |
| `qualified` | Enough is known to act, as defined by the flow |
| `pending` | Something is waiting on the business (approval, quote, link, callback) |
| `won` | Done deal: booked, reserved, bought, or closed |
| `lost` | A real prospect who did not buy |
| `not_relevant` | Never a fit (wrong service or area, job seeker, spam, supplier pitch) |

- `lost` and `not_relevant` take an optional reason (a short list plus free text).
- Labels come from UI copy per vertical. For example, `won` shows as "Booked" for `booking` and "Reserved" for `reservations`.
- "Cold" is **not** a stage. It is a follow-up reason (section 4), so a cold lead keeps the stage it stalled at.

### 3.2 Automatic mode uses signals

Stage derivation does not know about requests, collect stages or any domain. Sources emit `{ stage, reason }` signals, and `deriveLeadStage()` picks the highest-ranked one.

1. **Flow stage annotation.** A new optional field `StageBase.pipeline?: PipelineStageId`. While the lead's current conversation is on that flow stage, it emits that signal.
2. **Intent mapping.** A new optional field `ClassifyStage.pipelineByIntent?: Record<string, PipelineStageId>`. Example: `{ job_seeker: "not_relevant", spam: "not_relevant" }`. This lets the bot mark a lead `not_relevant` automatically.
3. **Capability hook.** An optional `pipelineSignals(snapshot)` on a registered capability. `booking` and `reservations` implement it: a pending request emits `pending`, an approved request emits `won`. Rejected requests emit nothing.
4. **Defaults.** Bot replied or intent known → `talking`; otherwise `new`.

Rank: `won` > `pending` > `qualified` > `talking` > `new`. An automatic `not_relevant` is a normal signal, and any higher-ranked signal overrides it.

Supporting a new flow type means annotating its JSON in the catalog template. `validateFlow()` rejects unknown stage ids in `pipeline` and `pipelineByIntent`.

### 3.3 Manual override

- The owner can set any of the 7 stages from the list row, the peek panel or the lead page. This sets `stageSource = manual`.
- A manual stage holds until a **strong event**, after which the lead returns to `auto`. As implemented in `src/lib/crm/stage.ts` (`deriveLeadStage`, ruling R4):
  - a request changes (is created or decided) after the manual choice;
  - for a manual **ranked** stage (`new` to `won`): an automatic signal ranked `pending` or `won`, **and** ranked above the current manual stage, **and** new evidence after the manual choice: the lead wrote after it (a request change already counts on its own, above). Signals carry no time, so a request approved or opened before the owner's choice never snaps the stage back by itself. A `talking` or `qualified` signal never overrides a manual stage, however low that manual stage ranks — only a `pending`/`won` signal that also outranks it does;
  - for a manual `lost` or `not_relevant`: the lead writes again (the timeline records this as "revived"), or a request changes. A signal can never override these two on its own.
- A manual `won` survives new inbound messages (for example, a past customer asking a question).
- Nothing sets a lead to `lost` automatically in phase 1.
- A flow with no annotations still works. Automatic mode gives `new` and `talking`, and the owner sets the rest by hand.

## 4. Follow-up engine

### 4.1 Reasons

| Priority | Reason | Due | Cleared by | Snooze |
|---|---|---|---|---|
| 1 | `handoff` (open HITL task) | Immediately | Task resolved | No |
| 2 | `approval` (pending request) | Immediately | Request decided | No |
| 3 | `reminder` (owner's next step) | `nextStepAt` | Marked done or rescheduled | Yes |
| 4 | `cold` | Our last message + 20h | Lead replies; owner messages them; next step set; stage becomes `won`, `lost` or `not_relevant` | Yes |

A lead stores one reason: the highest-priority reason that applies. The lead page lists all active reasons.

### 4.2 When a lead is cold

All of these must be true:
- The stage is `new`, `talking`, `qualified` or `pending`.
- The last message in the conversation is ours (from the bot or from staff).
- 20 hours have passed since that message.
- No reason with a higher priority is active.

`COLD_AFTER_HOURS = 20` is a constant in phase 1 and may become a tenant setting later.

### 4.3 No cron needed for the list

`refreshLeadState` stores `followUpAt` in advance. For example, when the bot replies it stores `cold` due at reply time + 20h. The "Needs you" tab is then a plain query — `needsWhere()` in `src/lib/crm/needs.ts`:

```
followUpReason IS NOT NULL AND followUpAt <= now()
AND (snoozedUntil IS NULL OR snoozedUntil <= now())
```

There is no `stage IN (...)` filter. `handoff` and `approval` apply at any stage — a past `won` customer can still open a new handoff and needs a reply — so filtering the query by stage would hide them. Only `cold` is limited to the active stages (`new`, `talking`, `qualified`, `pending`); that limit is enforced when `cold` is set (§4.2), not by filtering the query.

Leads appear in the tab as time passes, with no scheduled job. A cron runs only for the digest (section 6).

### 4.4 WhatsApp 24-hour window

- For WhatsApp leads, the window closes at `lastLeadMessageAt + 24h`.
- The row shows the time left when 3 hours or less remain (warning style), or "Window closed".
- When the window is closed, "Message" becomes "Open on your phone" (the existing `whatsappChatUrl`) instead of the in-app composer.

## 5. Screens

### 5.1 List: `/leads`

- **Pipeline strip.** Counts for `new`, `talking`, `qualified` and `pending`, plus `won` over the last 30 days. Clicking a stage filters the list.
- **Tabs:**
  - צריך אותך / Needs you: sorted by reason priority, then by how long the item has been due. This is the default tab when its count is above 0.
  - פעילים / Active: sorted by last activity.
  - Won: sorted by stage date.
  - Lost / not relevant: sorted by stage date.
  - All.
- **Filters:** channel and intent. Search covers name, phone, handle and note text.
- **Columns:**
  - Lead: initials avatar, channel dot, name, handle in an LTR-isolated span, unread dot.
  - Stage: a chip that opens a menu to override the stage.
  - Where it stands: one line (5.3).
  - Follow-up: reason chip plus age or due time.
  - Last contact: relative time, who wrote last, WhatsApp window.
- **Row actions**, shown on hover or focus: message, next step, snooze (only for `cold` and `reminder`).
- **Selecting rows** opens a bulk bar with: change stage, snooze, mark read.
- **Clicking a row** opens the peek panel. The list stays in place.
- **Mobile (≤ 640px):** rows become cards, the strip scrolls sideways, the peek panel becomes a full-screen sheet.
- The old `flowState` "Stage" column and the separate "Visit" column are removed. Bot internals move to the lead page.

### 5.2 Peek panel and lead page

The same `LeadView` renders in two sizes: a peek panel about 560px wide on the inline-end side, and a full page at `/leads/[id]`.

1. **Header.** Avatar, name, contact, intent. A stage stepper (`new` → `won`; `lost` and `not_relevant` show as a dashed closed state). The stage chip, with an "Auto · why" or "Manual · who" line.
2. **Follow-up bar** (only when a reason is active). It holds the page's single primary action:
   - handoff → Reply in Inbox
   - approval → Review in Inbox
   - reminder → Mark done
   - cold → Send message, or Open on your phone when the window is closed

   A secondary Snooze button appears for `cold` and `reminder`.
3. **Next step.** Text and a date, with presets (tomorrow 9:00, in 3 days, next week) and a Done button.
4. **Internal notes.** Author and time on each note, pin to the top, save with ⌘/Ctrl+Enter. Customers never see notes.
5. **Tabs:**
   - Conversation: the existing WhatsApp replica.
   - Activity: the timeline.
   - Details: collected fields and requests. These are existing panels, restyled.

### 5.3 "Where it stands" line

The first of these that exists: the next step text → the active request summary (`requestSummaryLines()`) → `Conversation.summary` → intent label plus the last lead message, cut to about 60 characters. Phase 1 adds no LLM calls.

### 5.4 Activity timeline

Newest first, grouped by day, with filters: All, Notes, Stages, Requests.

Sources:
- `LeadStageEvent`: stage changes, went cold, revived
- `LeadNote`
- `AdminDecisionLog`: next step set, done or snoozed; request decisions; HITL decisions
- `Request` creation
- `HitlTask` opened and resolved
- `Conversation` started, ended and reopened (`lifecycleReason`)
- nudges sent (message metadata)

Messages are not listed; they live in the Conversation tab. The pure function `buildLeadTimeline(sources)` merges everything.

### 5.5 In-app signals

- The sidebar badge for פניות shows the Needs you count, replacing the unread count. Unread becomes a dot on the row.
- The browser tab title shows the count, for example `(7) …`.

## 6. Daily WhatsApp digest

- **Transport.** A Meta-approved **utility template** sent through Zernio from a Zapidly platform number the product owner supplies. It has to be a template because the message is always outside the 24h window.
- **Template.** The body uses parameters. Parameters cannot contain line breaks. There is one URL button that opens `/leads?tab=needs`.
  ```
  בוקר טוב {{1}}, {{2}} פניות צריכות אותך היום:
  ממתינות לאישור: {{3}} · הועברו אליך: {{4}} · תזכורות: {{5}} · התקררו: {{6}}
  הדחופה ביותר: {{7}}
  ```
  An English version is also submitted. If the owner replies, the 24h window opens and the bot sends the full list as free text.
- **When.** 08:00 in the tenant's timezone (`Tenant.timezone`, default `Asia/Jerusalem`; `digestHour`, default 8). An Inngest cron runs every hour and selects the tenants whose local hour matches.
- **Rules:**
  - Nothing is sent when no items are due.
  - `DigestLog @@unique([tenantId, date])` stops the digest from being sent twice.
  - Each recipient opts in explicitly and stays opted in until they turn it off.
- **Flags.** `DIGEST_WHATSAPP_ENABLED` (env, kill switch) plus a per-tenant toggle, `Tenant.digestEnabled`.
- **Recipients.** A new table, `DigestRecipient(tenantId, clerkUserId, phone, optedInAt)`. The number and opt-in are set in Settings.
- **Lead time.** Submit the template to Meta on day 1 of implementation. Approval blocks this feature, not the rest of phase 1.

## 7. UI quality bar

The current screens use boxed cards and tables. Phase 1 raises the bar for all new CRM screens. **Colours stay on main's current tokens.** Components, layout and type change.

| Principle | Rule |
|---|---|
| Hierarchy | Use type weight and tone rather than boxes. Rows get thin dividers instead of card borders. One strong element per row |
| Type size | One step above today's scale: 12 / 13 / 14 / **15 body** / 17 / 22 / 28. The `--fs-*` tokens change once in `globals.css`, not per screen |
| Speed | Stage, snooze, next step and notes update optimistically, with an undo toast. Filters and tabs keep their state in the URL on the client, with no full-page form reloads |
| Stay in the list | Clicking a row opens the peek panel; a button expands it to the full page |
| Keyboard | `j`/`k` or arrows move, `Enter` opens, `Esc` closes, `s` stage, `n` next step, `z` snooze, `/` search. Keyboard actions are never animated |
| Motion | Peek panel: 240ms `cubic-bezier(0.32,0.72,0,1)`. A row leaving the list: opacity and translate over 160ms. Press: `scale(0.97)`. Hover effects only under `(hover: hover)`. Every one of these has a reduced-motion version |
| States | Skeleton rows while loading. "All caught up" empty state (one sentence, no invented numbers). Inline error with retry |
| Visual language | Initials avatars. The stage is a dot plus a label (hollow for `new`, filled for later stages, accent for `won`, dashed for closed). Follow-up chips tinted by reason. `tabular-nums` for times and counts. Contact details in `.ltr-isolate` |
| Primary action | At most one primary button per view. The list has none; on the lead page it is the follow-up action |
| Colour | Tokens only, no raw hex, both themes checked. The existing WhatsApp green rules for the chat surface still apply |
| Direction | Logical CSS properties only. Hebrew is the default; English is checked on every change |

The mockup linked at the top is the reference for components and layout.

## 8. Data model

```prisma
model Lead {
  // existing fields stay; `status` is kept read-only and dropped in a later migration
  stage             String    @default("new")
  stageSource       String    @default("auto")   // auto | manual
  stageReason       String    @default("")
  stageChangedAt    DateTime  @default(now())
  followUpReason    String?                      // handoff | approval | reminder | cold
  followUpAt        DateTime?
  snoozedUntil      DateTime?
  nextStepText      String?
  nextStepAt        DateTime?
  lastLeadMessageAt DateTime?
  lastOutboundAt    DateTime?

  stageEvents LeadStageEvent[]
  notes       LeadNote[]

  @@index([tenantId, followUpReason, followUpAt])
  @@index([tenantId, stage, updatedAt])
}

model LeadStageEvent {
  id          String   @id @default(cuid())
  tenantId    String
  leadId      String
  from        String
  to          String
  source      String   // auto | manual
  reason      String   @default("")
  actorUserId String?
  createdAt   DateTime @default(now())
  @@index([tenantId, leadId, createdAt])
  @@index([tenantId, to, createdAt])
}

model LeadNote {
  id           String   @id @default(cuid())
  tenantId     String
  leadId       String
  authorUserId String
  authorLabel  String   @default("")
  body         String
  pinned       Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([tenantId, leadId])
}

model DigestRecipient {
  id          String   @id @default(cuid())
  tenantId    String
  clerkUserId String
  phone       String
  optedInAt   DateTime?
  @@unique([tenantId, clerkUserId])
}

model DigestLog {
  id         String   @id @default(cuid())
  tenantId   String
  date       String   // YYYY-MM-DD in the tenant timezone
  sentAt     DateTime @default(now())
  recipients Json     @default("[]")
  @@unique([tenantId, date])
}

// Tenant: timezone String @default("Asia/Jerusalem"), digestEnabled Boolean @default(false), digestHour Int @default(8)
```

Every relation cascades on tenant and lead delete. Every query filters on `tenantId` from `requireTenantId()`.

## 9. Code units

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/lib/crm/derive.ts` | **Pure** functions `deriveLeadStage(signals, current)` and `deriveFollowUp(snapshot, now)` | Types only. No Prisma and no domain names (enforced by the architecture test) |
| `src/lib/crm/signals.ts` | Collects signals from flow annotations, capability hooks and defaults | Flow types, capability registry |
| `src/lib/crm/refresh.ts` | `refreshLeadState(tenantId, leadId, event?)`: load snapshot → derive → write columns → append `LeadStageEvent`. **The only code that writes these columns** | Prisma, derive, signals |
| `src/lib/crm/timeline.ts` | **Pure** `buildLeadTimeline(sources)` | Types only |
| `src/lib/crm/digest.ts` | Builds template parameters and the full list; sends through Zernio; writes `DigestLog` | Prisma, Zernio |
| `src/inngest/functions.ts` | New cron `crmDigest` (hourly) | digest |
| `src/lib/flow/types.ts`, `validate.ts` | `pipeline` and `pipelineByIntent` fields plus validation | — |
| Capabilities `booking`, `reservations` | Implement `pipelineSignals` | requests |
| Call sites | Call `refreshLeadState` from: `run-turn.ts` after a turn; `requests.ts` on create and decide; HITL open and resolve; `staff-message` route; the new CRM API routes | refresh |
| API | `PATCH /api/leads/[id]/stage`, `PUT /api/leads/[id]/next-step`, `POST /api/leads/[id]/snooze`, `POST/PATCH/DELETE /api/leads/[id]/notes`, `PATCH /api/leads/bulk` | refresh, tenant |
| UI | `/leads/page.tsx` becomes a server loader. New client components `LeadsList`, `PipelineStrip`, `LeadPeek`, `LeadView`, `LeadTimeline`, `NextStepEditor`, `LeadNotes`. Operator copy goes in `src/lib/ui/{he,en}.ts` | API |

## 10. Migration and rollout

1. Prisma migration (section 8). A backfill script calls `refreshLeadState` for every lead:
   - `status = won` or `lost` → manual stage with the same value;
   - `closed` → manual `lost`;
   - every other lead → automatic.
   - `lastLeadMessageAt` and `lastOutboundAt` come from `Message`.
2. Flag `CRM_V2` (per tenant): the new `/leads` and lead page. The old page stays reachable until the new one is signed off. Rollout order: dev tenant, then one real tenant, then everyone.
3. Flag `DIGEST_WHATSAPP_ENABLED` plus `Tenant.digestEnabled`. The Meta template is submitted on day 1.
4. After sign-off, stop reading `Lead.status` and drop it in a follow-up migration.

## 11. Testing

- **Unit, `derive`:**
  - every stage and signal ranking;
  - manual override held and broken by each strong event;
  - revival from `lost` and `not_relevant`;
  - a flow with no annotations;
  - the priority of all four reasons;
  - the cold boundary at exactly 20h;
  - snooze;
  - reminder due today and in the future.
- **Unit, `timeline`:** merging and grouping by day.
- **Unit, `digest`:** zero items sends nothing; parameters contain no line breaks; the `DigestLog` guard stops a second send.
- **Validation:** unknown ids in `pipeline` and `pipelineByIntent` are rejected.
- **Architecture test:** `crm/derive.ts` names no business domain.
- **Manual:** light and dark themes, Hebrew and English, 375px mobile, keyboard-only navigation, reduced motion.

## 12. Playbook (build order)

| # | Workstream | Output | Depends on |
|---|---|---|---|
| 0 | Submit the Meta utility template (He + En) | Template approval started | Platform number from the product owner |
| 1 | Schema + backfill | Migration, backfill script | — |
| 2 | Pure core | `derive.ts`, `timeline.ts` + tests | 1 |
| 3 | Signals + flow annotations | `signals.ts`, types, validation, booking and reservations hooks, catalog annotations | 2 |
| 4 | Single writer + call sites | `refresh.ts` wired into turn, requests, HITL, staff message | 3 |
| 5 | CRM API routes | stage, next step, snooze, notes, bulk | 4 |
| 6 | Type scale + UI primitives | `--fs-*` bump; chips, avatar, stepper, toast/undo, peek shell, popover menu | — (can run alongside 1–5) |
| 7 | List screen | Strip, tabs, filters, rows, bulk bar, keyboard, mobile cards (behind `CRM_V2`) | 5, 6 |
| 8 | Peek panel + lead page | Header, follow-up bar, next step, notes, tabs, timeline | 5, 6 |
| 9 | Sidebar count + tab title | Needs you count | 4 |
| 10 | Digest | Recipients settings, opt-in, cron, `DigestLog`, reply handling | 4, template approved |
| 11 | Rollout | Dev tenant → one real tenant → everyone; retire `status` | 7, 8 |
