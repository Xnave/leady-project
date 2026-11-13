# Documents auto-invite: first WhatsApp to new Smart NPV clients

Status: design, agreed with the product owner on 2026-11-13. Builds on PR #42 (Smart NPV clients synced into `Contact`, merged as `c86ab45`).

## Why

The documents capability can already collect mortgage documents over WhatsApp, and since #42 it knows each new Smart NPV client before they write: borrowers, names, IDs, phones, employment (`status_report_*`), loans and bank accounts sit in `Contact.mapped.checklist`. But nothing starts the conversation. Today a client has to message first, and then the bot asks profile questions we mostly already know the answers to.

This closes the loop: a new client appears in Smart NPV → the hourly sync stores them → we message them first → they tap one button → the bot goes straight to the documents, asking only what Smart NPV did not tell us.

Success: a new Smart NPV client gets one friendly WhatsApp from the advisor's number within business hours, taps "בואו נתחיל", and the next message they see asks for a document (or, rarely, one missing fact) — never a question whose answer is in Smart NPV.

## Goals

1. Send an approved WhatsApp **utility** template ("opener") to each newly synced Smart NPV contact, right after the sync that stored them.
2. If they do not start within ~2 days, send one **reminder** template. If still nothing, hand the client to the advisor as a task.
3. Ask the client the minimum: trust Smart NPV for the number of borrowers, and stop asking "first home".
4. Give the advisor (tenant owner/manager) an on/off switch in Documents settings, off by default, so he can stop all sending himself if something goes wrong.

## Non-goals

- Old clients. The sync only stores clients created after the source was connected (`freezeAfterFirstSync`, `syncSince`); that is by design. No backfill.
- Second borrower outreach. Only borrower 1 is messaged; borrower 1 sends both people's documents, as the flow already supports.
- Marketing. This is not a campaign: no "פרסומת" prefix, no opt-out button, no campaign template machinery (`src/lib/campaigns/templates.ts` is marketing-only and must not be reused for this).
- Using `transaction_type`. Its codes are unlabeled; the advisor will supply the list later. Until then first-home / transaction type does not change which documents are collected.
- Other connectors / CRMs. Smart NPV only for now, but nothing should name Smart NPV where a source-agnostic name works.

## Anti-goals (would be a failure even if it "works")

- Any message sent while the switch is off, outside the send hours, twice for the same stage, or to a contact who already has a conversation going.
- The bot introducing itself a second time after the opener already did.
- A duplicate send because an Inngest step retried after Zernio accepted the template (templates are paid).
- Asking the client something Smart NPV already answered.

## Decisions (made with the product owner)

| Topic | Decision |
|---|---|
| When | Right after the sync that stored the contact (the hourly `client-sources-hourly` run or a manual "sync now"), subject to send hours. |
| Send hours | Asia/Jerusalem: Sun–Thu 09:00–20:00, Fri 09:00–13:00. Never Saturday. A contact synced outside the window is sent at the next open hour. |
| Backlog | None. A contact is eligible only if it was stored **after** the switch was last turned on (and, in test mode, only test phones). Turning the switch on, or leaving test mode, does not invite earlier contacts — the advisor may already have called them. Store the moment the switch went on (and when test mode ended) to enforce this. |
| Who | Every newly stored Smart NPV contact with `phoneStatus = "ok"` and `skipped = false`, borrower 1's phone (`Contact.phone`). |
| Switch | "Auto-invite new clients" toggle in the owner's Documents settings (`/settings/documents`), stored on the documents `CapabilityInstance` config. Default **off**. Turning it off stops openers and reminders immediately. |
| Opener | Utility template, one quick-reply button, text below. |
| No reply | One reminder after ~48h (counted in send-window time is not required; wall clock is fine, then wait for the window). Still nothing ~48h after the reminder → open a HITL task for the advisor ("didn't start"). Nothing more is sent automatically. |
| Questions | Do not ask `second_borrower` for Smart NPV contacts (trust the borrower count). Do not ask `first_home` at all for now. Still ask employment when `status_report` is empty and loans when unknown. |
| Delivery | New PR off `main`, separate from #42. |

### Template text (Hebrew, both utility, language `he`)

`{{1}}` = client first name (borrower 1, from `mapped`). `{{2}}` = a new Documents setting, "name shown to clients" (owner-editable, prefilled from the tenant name; nothing is sent while it is empty). For Lior it is `ליאור - לייבל משכנתאות`, so the opener reads "כאן העוזר הדיגיטלי של ליאור - לייבל משכנתאות"; use that as the example value submitted to Meta. Meta rule: a variable may not start or end the body.

Opener:

```
שלום {{1}} 👋
כאן העוזר הדיגיטלי של {{2}}.
כדי להתקדם עם המשכנתא נאסוף כאן
בווטסאפ את המסמכים הדרושים.
זה לוקח כמה דקות.

[ בואו נתחיל ]
```

Reminder:

```
היי {{1}}, מה שלומך? 😊
רק מזכירים שאפשר לשלוח כאן
את המסמכים למשכנתא במקום אחד,
בקצב שלכם.
צוות {{2}} כאן בשבילכם 💙

[ בואו נתחיל ]
```

Template names must be versioned (`…_v1`): an approved template's text cannot be edited in place, a change means a new name.

## How it fits the existing system

What already exists and should be reused, not rebuilt:

- **Sync**: `clientSourceSync` / `clientSourcesHourly` in `src/inngest/functions.ts`, `finishSourceSync` in `src/lib/client-sources/store.ts`. The invite pass runs after a sync finishes (a new step or a follow-up event — builder's call), plus its own hourly pass so reminders, escalations and "synced at night, send at 09:00" work without a new sync.
- **Contact data**: `Contact.mapped.checklist` is the profile built by `factsFromClient` (`src/lib/documents/facts.ts`). `storedClientByPhone` (`src/lib/documents/client-sync.ts`) is how the documents flow already finds the contact when the client writes.
- **Sending templates**: `sendWhatsAppTemplate` in `src/lib/zernio.ts` (returns Zernio's `conversationId`). Owner alerts (`src/lib/crm/alerts-send.ts`) are the pattern: check the template is approved first, send, never throw after a successful send.
- **Template definitions**: follow `src/lib/crm/digest-templates.ts` + `scripts/digest-templates.ts` (code is the source of truth, a script submits to Zernio, approval is checked with `listWhatsAppTemplates`). Difference: digest templates live on the platform number; these must be created on **the tenant's own WhatsApp account** (`tenantWhatsAppAccount` in `src/lib/campaigns/store.ts` finds it), because the client must hear from the advisor's number.
- **Test mode**: the documents config has `testOnly` / `testPhones` (`isTestLead`). While the tenant is in test mode, invites go only to test phones. This is the safe rollout path.
- **Advisor tasks**: `HitlTask` (`type: "more_info"`, like `notifyAdvisor` in `dossier.ts`), then `safeRefreshLeadState`.

## Calls made by the designer (not discussed with the owner; check while reading)

- **Already in conversation:** do not invite when either borrower phone (`Contact.phone` or `mapped.phone_2`) has ever sent an inbound message to this tenant, on any channel. If a Lead already exists for borrower 1's phone, link to it instead of creating a new one.
- **Unknown send result** (timeout / 5xx after the request left): never retried automatically (a retry risks a second paid send). Mark the contact `unknown` and open a HITL task for the advisor. A definite rejection (4xx from Zernio/Meta) is a stop with the reason stored.
- **Quick-reply tap payload is unverified.** `parseZernioMessageReceived` reads only `message.text`. First implementation step: send the opener to a test phone, tap the button, capture the webhook payload, and extend the parser if the tap is not plain text. Independently, *any* inbound message from the contact's phone marks the invite as started, whatever its text.

## What has to be built

1. **Invite state per contact.** Enough to know: opener sent (when, template, Zernio conversation), reminder sent (when), escalated (when), started (client replied), stopped (and why: switch off at the time is *not* a stop; an explicit "stop"/"הסר" reply, a failed send, or a phone that turned out not to be on WhatsApp are). Columns on `Contact` or a small table — builder's call; it ships as a Prisma migration. Must make "send at most once per stage" enforceable even under retries (e.g. claim the row before calling Zernio, record the result after).
2. **Template definitions + submit script** for the two templates, per tenant account, with an "approved?" check before any send. If a template is not approved, nothing is sent and the settings screen says so.
3. **Invite job.** Selects due contacts per tenant (switch on, documents capability enabled, Smart NPV source, in send hours, state allows the next step, no inbound message from that phone yet), sends, records. Bounded per run so a large first sync cannot burst (Meta tier limits apply to the advisor's number).
4. **Conversation continuity.** When the client taps the button, the existing inbound path runs. Requirements: the bot must not re-introduce itself (the opener did that); the first reply asks for the first open fact or, usually, the first document; the opener/reminder should appear in the conversation history in the CRM. The likely approach is to create/link the Lead + Conversation at send time and store the template text as an outbound agent message, so `hasAgentReplied` is true — builder to confirm against `src/lib/persona/greeting.ts` and the documents intro path.
5. **Fewer questions.** In `facts.ts`: for profiles from a Smart NPV contact, treat the borrower count as known (`secondBorrower: "no"` when only borrower 1 exists); remove `first_home` from `openQuestions` (keep the field and its parsing so the advisor's later `transaction_type` mapping can bring it back). Update `rules.test.ts` / scenario tests accordingly.
6. **Settings UI.** Toggle in Documents settings (`src/components/DocumentsSettingsForm.tsx`, `/api/settings/documents`), owner-facing copy in both `src/lib/ui/en.ts` and `he.ts`; show template approval status and a small count (invited / started / waiting / handed to you).
7. **Stop handling.** A reply of "הסר"/"stop" (or similar) to an opener/reminder stops further automatic messages to that contact. No opt-out button is required on a utility template, but the request must be respected.

## Constraints

- Tenant isolation: every query filters on `tenantId` (see `requireTenantId`).
- Customer-facing text in `src/lib/copy/{en,he}.ts`; operator text in `src/lib/ui/{en,he}.ts`. Template bodies live with the template definitions.
- The interpreter stays domain-free (`architecture.test.ts`); this is documents-capability and client-sources code, not kernel code.
- Production schema changes are applied by a person with `scripts/db-production.sh` before merge (CI "Diff against production" is required).
- Tests: pure selection logic (send hours, due-state transitions, idempotency) as unit tests with fake time; no network in `npm test`.

## Left to the builder

- Columns vs. table for invite state; exact state names.
- Whether the post-sync trigger is an extra step inside `clientSourceSync` or an event to a new function; the hourly pass is required either way.
- Per-run send cap value.
- Exact stop-word list.
- How the settings counters are laid out.
