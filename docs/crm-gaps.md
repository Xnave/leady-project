# CRM gaps — the business-owner view

Audit of what a Leady owner can and cannot do in the dashboard today, written from
the owner's job rather than the code's shape. The owner's job is three questions:

1. **Is anything stuck on me right now?**
2. **Is the agent actually earning its keep?**
3. **Can I step in when it matters?**

Everything below is scored against those. Shipped items are marked; the rest is a
prioritized backlog with the UX shape each one wants.

---

## Shipped in this pass

### 1. Human takeover (the biggest hole)

Before: an owner **could not send a message to a customer**. The only composer in
the product (`ChatComposer` → `POST /api/demo/message`) fakes an *inbound* message
from the customer and lets the agent answer. Pointed at a live WhatsApp lead that
writes a fake customer line into the transcript and makes the bot reply to it. The
one human-authored text that ever reached a customer was the note inside a HITL
task completion.

Now:

- `POST /api/leads/[id]/reply` — sends the owner's own text over the lead's channel
  via `sendOnChannel`, saved as a `human` message so the transcript shows who spoke.
- `POST /api/leads/[id]/bot` — mutes/unmutes the agent for that conversation by
  moving `conversations.status` between `open` and `waiting_human` (the same state
  the interpreter already honours). Handing back to the agent also closes the open
  HITL tasks on that conversation, so the Inbox badge stops counting work the owner
  finished in the chat.
- `TakeoverPanel` on `/leads/[id]` and inside each `/inbox` task: a two-state
  segmented control ("Agent is answering" / "You are answering") plus a reply box.
- The simulator composer on `/leads/[id]` is now shown only for demo leads, where
  faking an inbound message is the point.

### 2. A dashboard that answers "is this working"

`/` used to show three numbers (leads, tasks, WhatsApp on/off). It now also carries:

- **Needs you now** — open HITL tasks, pending visit approvals, and conversations
  paused for a human, each a direct link. Empty state says so plainly.
- **Last 7 days** — new leads today/this week, active conversations, conversations
  paused for the owner, visits pending vs. approved, messages in/out, and
  *handled without you*: the share of the last 30 days' conversations the agent
  closed without escalating. That last number is the product's value proposition
  expressed as a metric, and nothing in the CRM stated it before.

Lives in `src/lib/metrics.ts` (`getOwnerMetrics`) — count queries only, no scans.

### 3. `/leads` rebuilt as a conversation dashboard

The page was a table: eight equal-weight columns, one clickable name link, no
sense of time. An owner scanning sixty chats needs four things per row — who,
what was last said, when, and whether it is stuck on them — and a table gives all
eight the same emphasis.

It is now a **day ledger**:

- **Grouped by day**, newest first, with "Today" / "Yesterday" / a spelled-out
  date and a per-day count. The time axis is visible without reading a single
  timestamp.
- **Date range tabs** — today / 7 days / 30 days / all — as the page's primary
  axis, styled as navigation rather than as one more filter pill.
- **A pulse strip** scoped to the same filters: in view, waiting on you, visits to
  approve, visits approved. The numbers and the list can never disagree.
- **Rows carry a state rail** on the inline-start edge: amber when the
  conversation is paused for the owner or has an unapproved visit, green when
  active, grey when the lead is decided or the conversation is closed. Sixty rows
  become a stripe you can read at a glance.
- **The whole row opens the conversation**, via a stretched link, with the status
  select layered above so it stays independently clickable. (The link itself must
  not clip — an `overflow: hidden` on it clips its own overlay and silently kills
  the row click.)
- Each row shows the last message with its speaker, the captured phone, the
  channel, and the date of the first message. A stage chip appears only when the
  stage is something other than `talk`, which is where nearly every live
  conversation sits.
- Filter by lead status (folding legacy `closed` rows into "lost"); search now
  covers the captured contact fields (`fields.phone`, `fields.email`,
  `fields.name`), not just `displayName`/`externalUserId`.
- **Export CSV** honouring the active filters (`GET /api/leads/export`), UTF-8 BOM
  so Excel opens Hebrew names correctly. The owner's list is never trapped.
- Filters round-trip through pagination via `src/lib/lead-query.ts`, shared by the
  page and the export so they can never disagree. Day grouping, previews, initials
  and row state live in `src/lib/conversation-list.ts` under unit test.

For the date axis to be honest, `lead.updatedAt` had to mean "last activity", so
`persistInboundIfNew` and `sendHumanReply` now touch the lead row. A replayed
webhook does not — it fails the `providerMessageId` uniqueness check first.

### 4. `npm run lint` (incidental)

`eslint.config.mjs` contained `import type { NextConfig } from "eslint/config"` in
a `.mjs` file, so every lint run died with `SyntaxError: Unexpected token '{'`.
Replaced with a real flat config via `FlatCompat`. Lint now reports two
pre-existing warnings and nothing else.

---

## Backlog, highest value first

### P1 — Owner never learns anything happened

**Gap.** A HITL task, a visit request, or a paused conversation only exists inside
the dashboard. Nothing reaches the owner. A small-business owner does not sit in a
CRM tab; they are on WhatsApp. A booking request that waits four hours is a lost
customer, and today nothing prevents that.

**Shape.** Notify on the owner's own channel. `Tenant.phone` already holds a number.
On `pauseForHuman` and `requestTentativeMeeting`, send the owner a WhatsApp message
through the tenant's own connection: "דנה מבקשת פגישה ליום ג' 16:00 — לאישור: <link>".
Deep-link straight to `/inbox?task=…`.

**Needs.** A `NotificationPreference` (channel, quiet hours, which events), throttling
so a busy hour is one digest rather than twenty pings, and a delivery record so the
same event is never sent twice. Email as the fallback when no WhatsApp is connected.

**Effort.** Medium. The send path exists; the policy and dedupe are the work.

### P2 — Read the thread without leaving the list

**Partly shipped.** `/leads` is now the conversation list described above, so the
"all my chats, newest first" view exists. What is still missing is reading in
place: every row is a full page navigation, so skimming five conversations costs
five round trips.

**Shape.** Split the page — list on the inline-start side, the selected thread and
the takeover panel on the other, with the selection in the URL (`?open=<leadId>`)
so it stays linkable and server-rendered. On narrow screens the list stays
full-width and the thread remains its own page.

**Effort.** Medium. All the data and both components already exist.

### P3 — Failures are invisible

**Gap.** `sendOnChannel` swallows every error — a Zernio 4xx, a missing
`zernioConversationId`, an expired token all `console.error` and return. The owner
sees the message in the transcript and believes the customer got it. They did not.

**Shape.** Persist send state on `Message` (`deliveryStatus`, `deliveryError`,
`deliveredAt`). Render a failed bubble with a retry action. Raise a channel-level
banner on `/channels` and the dashboard when the connection itself is broken
("WhatsApp disconnected — reconnect"), because a dead token silently kills every
conversation at once.

**Effort.** Small–medium, and it protects trust more than any feature below.

### P4 — Nothing to say about a lead

**Gap.** No notes, no tags, no activity timeline, no assignment. `Lead.fields` holds
only what the agent extracted. An owner cannot record "called her, wants a quote
next week" — so they keep the real CRM in their head or in WhatsApp.

**Shape.** A `LeadNote` model (author, body, createdAt) rendered as a timeline on
`/leads/[id]` interleaved with status changes, meetings, and escalations. Free-text
tags on `Lead` with a filter chip row on `/leads`.

**Blocked on.** There is no `User` model at all — the whole product is one anonymous
owner per tenant, and every actor is hardcoded `"owner"` (`completeHitlTask`,
`markMeetingDecision`). Notes without authorship are half a feature, so P4 wants
P7 first, or ships with `savedBy` free text as an interim.

### P5 — Meetings have no home

**Gap.** `Meeting` rows are the closest thing to revenue in the schema, and they are
only visible pending-on-`/leads` or inline on a lead. There is no upcoming list, no
past list, no way to see next week.

**Shape.** `/meetings` with Upcoming / Pending / Past tabs, and an owner-facing
outcome on each (`showed`, `no_show`, `won`, `lost`) that feeds a real conversion
number on the dashboard. `slotText` is free text today — a nullable `startsAt`
`DateTime` alongside it would unlock sorting, reminders, and an .ics export without
breaking the current LLM-extracted string.

**Effort.** Medium; the `startsAt` parse is the interesting half.

### P6 — Knowledge is one textarea

**Gap.** `Agent.knowledgeText` is a single blob on `/ops` — a screen the sidebar
files under "Staff". An owner who wants to add "we're closed on the 3rd" or fix a
wrong answer has to find that page and edit prose, with no way to check the result.
`/api/ops/preview` exists but nothing on `/ops` links a knowledge edit to a test run.

**Shape.** Owner-facing `/knowledge`: a list of Q&A pairs and short facts, each
editable, each with "test this question" that runs the preview and shows the answer
the agent would give. Keep compiling to `knowledgeText` under the hood so the
runtime does not change. File upload already exists in `/onboard` — reuse it here.

**Effort.** Medium. High perceived value: this is where owners feel ownership of
their bot.

### P7 — One anonymous owner per tenant

**Gap.** No `User` model, no team. Every action is attributed to the literal string
`"owner"`. A business with a receptionist and a manager cannot tell who approved a
booking or who replied. Clerk is already in the stack for org resolution, so the
identity exists — it just never reaches the data.

**Shape.** `User` (clerkUserId, tenantId, role: owner/agent), `assignedToId` on
`Lead`, real `savedBy`/`completedBy`/`decidedBy`, and an "assigned to me" filter.

**Effort.** Large-ish, but it gates P4 and every audit question.

### P8 — No after-hours behaviour

**Gap.** `Tenant.venueHours` is free text the agent may quote, but the agent answers
identically at 03:00 and 11:00. An owner cannot say "outside hours, tell them we'll
answer in the morning" or "never book a slot on Saturday".

**Shape.** Structured opening hours on the tenant (per-day ranges + timezone), an
after-hours reply template, and a bookable-window constraint the booking stage
respects.

### P9 — Cannot see what the bot got wrong

**Gap.** Every escalation is a signal that the agent failed, and that signal is
discarded — `HitlTask.reason` is written and never aggregated. The owner has no
"top reasons customers asked for a human" and therefore no way to improve the bot.

**Shape.** Group open + resolved tasks by reason over 30 days on the dashboard, with
a thumbs-down on any agent message that files the message and its context for review.
That feedback set is also the raw material for tuning `knowledgeText`.

### P10 — Smaller, cheap wins

- **Global pause.** Per-conversation mute now exists; there is no "stop the bot on
  everything" for a holiday or an incident. A boolean on `Agent` checked in
  `interpretTurn` plus a switch on `/ops`.
- **Bulk actions** on `/leads` (status change, tag, export selection).
- **Sortable columns** — the table is always `updatedAt desc`.
- **Transcript search** across messages; today only names and contact fields match.
- **Saved views** ("new this week", "waiting on me") as URL presets.
- **Duplicate leads.** `Lead` is unique per `(tenant, channel, externalUserId)`, so
  the same person on WhatsApp and Instagram is two leads with no way to merge them.
- **`/ops` is owner-facing work filed under "Staff".** Catalog choice, knowledge, and
  escalation policy are the owner's decisions; the sidebar tells them otherwise.

---

## Environment note

`npm test` fails on Node 20.18.3 — Vite 7 requires ≥ 20.19 and dies with
`ERR_REQUIRE_ESM` while loading `vitest.config.ts`. Under Node 22 the suite passes
(54 tests). Worth pinning the version in `package.json` `engines` or `.nvmrc`.
