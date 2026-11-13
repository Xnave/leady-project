# Documents Auto-Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Message each newly synced Smart NPV client first (opener → one reminder → advisor task), from the advisor's own WhatsApp number, behind an owner switch that is off by default, and stop asking questions Smart NPV already answered.

**Architecture:** Invite state lives in columns on `Contact`. A pure planner (`src/lib/documents/invite/plan.ts`) decides the next step for a contact at a given time; a DB runner (`invite/run.ts`) claims the row, sends the template through Zernio, and stores the opener as an agent message on a Lead + Conversation it creates, so the bot never re-introduces itself. An Inngest function runs the runner after every sync and hourly. The webhook marks invites started / stopped.

**Tech Stack:** Next.js route handlers, Prisma/Postgres, Inngest, Zernio WhatsApp API, vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-documents-auto-invite-design.md`

## Global Constraints

- Every Prisma query filters on `tenantId`.
- Send hours, Asia/Jerusalem: Sun–Thu 09:00–20:00, Fri 09:00–13:00, never Saturday. End hour exclusive.
- Reminder ~48h after opener; escalation (HITL `more_info`) ~48h after reminder. Nothing else is sent automatically.
- Eligible: `phoneStatus = "ok"`, `skipped = false`, source kind `smartnpv`, `Contact.createdAt` after the switch went on (and after test mode ended when not in test mode); in test mode only test phones.
- Only borrower 1 (`Contact.phone`) is messaged. No contact whose `phone` or `mapped.phone_2` ever sent this tenant an inbound message.
- Never retry a send whose result is unknown; a claimed row is never sent again.
- Templates are UTILITY, language `he`, one quick-reply button "בואו נתחיל", versioned names `…_v1`, created on the tenant's own WhatsApp account (`tenantWhatsAppAccount`). Not the campaign template code.
- `{{2}}` = documents setting "name shown to clients"; nothing is sent while it is empty.
- Operator copy in `src/lib/ui/{en,he}.ts` (+ `types.ts`); template bodies live with the template definitions.
- Interpreter stays domain-free; no change under `src/lib/flow/interpreter.ts`.
- Schema change ships as a hand-written migration applied with `npx prisma migrate deploy` (dev DB carries unmerged migrations; never reset).
- No network in `npm test`; time is passed in.

## Review Focus

1. Inngest retry after Zernio accepted the template → row already claimed (`sending_*`), never resent; stale claim becomes `unknown` + advisor task. Test in Task 2 (`planInviteStep` on stale `sending_opener`).
2. Saturday / Friday 13:00 / 20:00 boundaries in Jerusalem across DST → `inSendWindow` tests in Task 2 for a winter and a summer date.
3. Client replies "הסר" to the opener → stopped, no reminder, and the bot does not answer with a document request. Test in Task 2 (`isStopReply`) and Task 5 (webhook skips the turn on `stopped`).
4. Zernio sends the sender as `+972…` while the invite created the Lead as another form → the tap lands on the invite's Lead, not a fresh one that re-introduces the bot. Test in Task 5 (`whatsappExternalIdVariants`).
5. Turning the switch off then on again → contacts stored while it was off are not invited. Test in Task 3 (`applyInviteSettings` resets `autoInviteOnAt`) + Task 2 cutoff test.

---

### Task 1: Fewer questions (facts)

**Files:**
- Modify: `src/lib/documents/facts.ts` (`openQuestions`, `factsFromClient`)
- Modify: `src/lib/documents/client-sync.ts` (`storedClientByPhone`)
- Test: `src/lib/documents/rules.test.ts`, plus any scenario test that expected `first_home`

**Interfaces:**
- Produces: `openQuestions` never yields `first_home`; `factsFromClient(raw)` sets `secondBorrower: "no"` when only borrower 1 exists.

- [ ] Step 1: Update tests: `rules.test.ts:102` / `:321` / `:331` no longer expect `first_home`; add `it("trusts the Smart NPV borrower count")`: `factsFromClient({ firstname_1: "דנה", phone_1: "0501234567", id_1: "123456782" })` → `secondBorrowerOf(...) === "no"` and `openQuestions(...).map(k=>k.kind)` does not contain `second_borrower` or `first_home`.
- [ ] Step 2: `npx vitest run src/lib/documents` → new expectations FAIL.
- [ ] Step 3: Drop the `first_home` push in `openQuestions` (keep `FirstHome` type, parsing, `advisorReason`). In `factsFromClient` set `secondBorrower: borrowers.some(b=>b.slot==="2") ? undefined : "no"` (omit key when 2 borrowers). In `storedClientByPhone`, when the stored checklist has no `secondBorrower` and no slot-2 borrower, set `"no"` (older rows synced before this change).
- [ ] Step 4: `npx vitest run src/lib/documents` → PASS (fix scenario tests whose next question was `first_home`).
- [ ] Step 5: Commit `feat(documents): trust Smart NPV borrower count, stop asking first home`.

### Task 2: Invite state + pure planner + templates

**Files:**
- Modify: `prisma/schema.prisma` (Contact)
- Create: `prisma/migrations/20261113120000_contact_invite_state/migration.sql`
- Create: `src/lib/documents/invite/plan.ts`, `src/lib/documents/invite/templates.ts`
- Test: `src/lib/documents/invite/plan.test.ts`, `src/lib/documents/invite/templates.test.ts`

**Interfaces:**
- Contact columns: `inviteStatus String @default("")` (`"" | sending_opener | invited | sending_reminder | reminded | started | escalated | stopped | unknown`), `inviteStopReason String @default("")`, `inviteClaimedAt DateTime?`, `inviteOpenerAt DateTime?`, `inviteReminderAt DateTime?`, `inviteEscalatedAt DateTime?`, `inviteStartedAt DateTime?`, `inviteConversationId String @default("")` (Zernio), `@@index([tenantId, inviteStatus])`.
- `inSendWindow(now: Date): boolean`
- `type InviteStep = "opener" | "reminder" | "escalate" | "unknown" | null`
- `planInviteStep(c: { inviteStatus: string; inviteClaimedAt: Date|null; inviteOpenerAt: Date|null; inviteReminderAt: Date|null }, now: Date): InviteStep` — `""`→opener; `invited` & opener ≥48h→reminder; `reminded` & reminder ≥48h→escalate; `sending_*` claimed ≥10min→unknown; else null. (Window check is the caller's, since escalate/unknown need none.)
- `INVITE_REMINDER_AFTER_MS = 48h`, `INVITE_CLAIM_STALE_MS = 10min`, `INVITE_SEND_CAP = 20`.
- `isStopReply(text: string): boolean` — trimmed, case-insensitive, punctuation stripped, whole message equals one of `הסר, הסירו, להסיר, הפסק, תפסיקו, stop, unsubscribe, remove`.
- `inviteFirstName(contact: { name: string; mapped: unknown }): string` — first token of `mapped.checklist.borrowers[0].fullName`, else of `name`.
- `invitedAfter(contactCreatedAt: Date, cutoff: Date|null): boolean` — false when cutoff null.
- templates.ts: `INVITE_TEMPLATES: Record<"opener"|"reminder", InviteTemplate>` with names `documents_invite_opener_v1`, `documents_invite_reminder_v1`, bodies verbatim from the spec (button line not in body), `button: "בואו נתחיל"`, `example: ["דנה", "ליאור - לייבל משכנתאות"]`; `inviteTemplateParams(firstName, displayName): string[]` (sanitised with `sanitizeTemplateParam` from `@/lib/crm/digest`, 40 chars); `fillInviteBody(t, params)`; `inviteTemplateCreateBody(t, accountId)` (BODY with example + BUTTONS QUICK_REPLY, no footer).

- [ ] Step 1: Tests: `inSendWindow` true Sun 2026-11-15 09:00 IL (07:00Z), false 08:59, false Thu 20:00, true Fri 12:59, false Fri 13:00, false any Sat hour, true summer Sun 2026-06-14 09:00 IL (06:00Z). `planInviteStep` each branch above incl. 47h → null and stale claim → `unknown`, fresh claim → null, `started/stopped/escalated/unknown` → null. `isStopReply("הסר")`, `("  STOP! ")` true; `("בואו נתחיל")`, `("אני רוצה להסיר את השעבוד")` false. Templates: no body starts or ends with `{{`, filled opener contains `כאן העוזר הדיגיטלי של ליאור - לייבל משכנתאות.`, create body has one QUICK_REPLY button.
- [ ] Step 2: Run → FAIL (modules missing).
- [ ] Step 3: Implement. `inSendWindow` via `Intl.DateTimeFormat("en-US",{timeZone:"Asia/Jerusalem",weekday:"short",hour:"numeric",hourCycle:"h23"})`. Schema + migration SQL (`ALTER TABLE "Contact" ADD COLUMN …` + index), apply with `npx prisma migrate deploy && npx prisma generate`.
- [ ] Step 4: Run → PASS; `npm run typecheck`.
- [ ] Step 5: Commit `feat(documents): invite state, send window and templates`.

### Task 3: Settings model (switch, display name, cutoffs)

**Files:**
- Modify: `src/lib/flow/document-config.ts`
- Test: `src/lib/flow/document-config.test.ts`

**Interfaces:**
- `DocumentConfig` gains `autoInvite: boolean`, `autoInviteOnAt: string` (ISO or ""), `clientDisplayName: string` (≤60 chars), `testModeEndedAt: string`.
- `inviteTestMode(config): boolean` = `config.testPhones.length > 0`.
- `applyInviteSettings(existing: DocumentConfig | null, next: DocumentConfig, now: Date): DocumentConfig` — off→on sets `autoInviteOnAt=now`; stays on keeps it; off clears nothing but `autoInvite=false`; test phones non-empty→empty sets `testModeEndedAt=now`.
- `inviteCutoff(config): Date | null` — null when off or `autoInviteOnAt` empty; else max(`autoInviteOnAt`, `testModeEndedAt` when not in test mode).
- `parseDocumentConfig` reads `autoInvite`, `clientDisplayName` from the body and keeps `autoInviteOnAt`/`testModeEndedAt` from the stored row (new 5th param `existing?: Partial<DocumentConfig>`), so saving the form never drops them; `publicDocumentConfig` exposes `autoInvite`, `clientDisplayName`.

- [ ] Step 1: Tests: off→on stamps now; on→on keeps first stamp; on→off→on restamps; clearing test phones stamps `testModeEndedAt`; `inviteCutoff` picks the later stamp only outside test mode; parse keeps stored stamps.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(documents): auto-invite settings and cutoffs`.

### Task 4: Invite runner + Inngest + template script

**Files:**
- Create: `src/lib/documents/invite/run.ts`, `scripts/invite-templates.ts`
- Modify: `src/inngest/functions.ts`, `src/lib/client-sources/store.ts` (`runSourceSyncInline` calls the runner in dev)
- Test: `src/lib/documents/invite/run.test.ts` (send-result classification only; DB paths verified manually)

**Interfaces:**
- `classifySendError(err: unknown): { kind: "rejected"; reason: string } | { kind: "unknown"; reason: string }` — `ZernioApiError` with 400–499 → rejected, everything else unknown.
- `approvedInviteTemplates(accountId): Promise<Set<"opener"|"reminder">>` (live `listWhatsAppTemplates`, status `APPROVED`).
- `runInvitesForTenant(tenantId: string, now: Date): Promise<{ sent: number; reminded: number; escalated: number; unknown: number; skipped?: string }>`. Order: load documents config (skip `off`, `no_cutoff`, `no_display_name`), documents capability enabled, `tenantWhatsAppAccount` (skip `no_whatsapp`), channel row for that account; mark stale claims `unknown` + task; escalate due `reminded`; if `inSendWindow(now)`: load approvals once, then due openers then reminders, at most `INVITE_SEND_CAP` sends. Per contact: skip if `alreadyInConversation`; claim with `updateMany({where:{id, tenantId, inviteStatus: prior}, data:{inviteStatus:"sending_…", inviteClaimedAt: now}})` and continue only when `count === 1`; ensure Lead (existing by phone variants on that channel, else create `externalUserId: "+"+phone`, `displayName: contact.name`, fields `{phone, name}`) + open Conversation (`flowState: agent.flow.start`, `lifecycleReason: "documents_invite"`), link `Contact.leadId`; send; on success write `invited/reminded`, times, `inviteConversationId`, lead `fields.zernioConversationId`, `insertAgentMessage(… fillInviteBody …, {providerMessageId: "invite-<step>-<contactId>", leadId})`, `safeRefreshLeadState`; never throw after a successful send (catch + log). On rejected → `stopped` + reason. On unknown → `unknown` + task.
- `alreadyInConversation(tenantId, phones: string[]): Promise<boolean>` — any `Message` role `lead` whose conversation's lead `externalUserId` is a variant of either phone.
- `openInviteTask(contact, reason: "invite_no_start" | "invite_send_unknown")` — `HitlTask` `type:"more_info"`, `reason` as given, payload `{kind:"documents_invite", contactId}`; needs the contact's Lead/Conversation (create via the same ensure helper if missing).
- `recordInviteReply(tenantId: string, from: string, text: string, now: Date): Promise<"stopped"|"started"|"none">` — finds contact by phone variants with status in (`invited`,`reminded`,`escalated`,`unknown`,`sending_*`); stop reply → `stopped`/`client_stop`, else `started` + `inviteStartedAt`.
- `inviteStats(tenantId): Promise<{ invited: number; started: number; waiting: number; handedOff: number; stopped: number }>` (waiting = invited+reminded+sending, handedOff = escalated+unknown).
- Inngest: `documentInvites` on event `documents/invites.requested` `{tenantId}` and cron `30 * * * *` (cron fans out one event per tenant with `autoInvite` true via `send`), `concurrency: [{ key: "event.data.tenantId", limit: 1 }]`, `retries: 0` (a retried run cannot double-send anyway; no retries keeps unknown cases rare). `clientSourceSync` sends the event after `finish` when stats `created > 0`.
- Script: `npx tsx scripts/invite-templates.ts status <tenantId>|submit <tenantId>` using `tenantWhatsAppAccount`.

- [ ] Step 1: Test `classifySendError`: `new ZernioApiError(400,{error:"bad"})` → rejected; `ZernioApiError(503)` → unknown; `new TypeError("fetch failed")` → unknown.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement runner, Inngest wiring, script.
- [ ] Step 4: Run → PASS; `npm run typecheck`; manual: in dev DB, a tenant with no live WhatsApp channel returns `{ skipped: "no_whatsapp" }` and touches no contact.
- [ ] Step 5: Commit `feat(documents): invite runner, Inngest job and template script`.

### Task 5: Inbound continuity + stop handling

**Files:**
- Modify: `src/lib/conversations.ts` (`persistInboundIfNew` lead lookup), `src/app/api/webhooks/zernio/route.ts`, `src/app/api/dev/inbound/route.ts`
- Create helper `whatsappExternalIdVariants(id: string): string[]` in `src/lib/documents/invite/plan.ts`
- Test: `plan.test.ts`

**Interfaces:**
- `whatsappExternalIdVariants("+972501234567")` → `["+972501234567","972501234567"]`, and the reverse; non-phone ids → `[id]`.
- `persistInboundIfNew`: on a WhatsApp channel, when no Lead has the exact `externalUserId`, reuse a Lead on the same channel with a variant id before upserting.
- Webhook: after persist, `const reply = await recordInviteReply(...)` (wrapped, never fails the webhook); on `"stopped"` refresh lead state and return without enqueueing the turn.

- [ ] Step 1: Test variants.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → PASS; existing `conversations.persist.test.ts` still PASS.
- [ ] Step 5: Commit `feat(documents): invite replies start or stop the invite`.

### Task 6: Settings UI + API

**Files:**
- Modify: `src/app/api/settings/documents/route.ts`, `src/app/(app)/settings/documents/page.tsx`, `src/components/DocumentsSettingsForm.tsx`, `src/lib/ui/{types,en,he}.ts`

**Interfaces:**
- POST body gains `autoInvite?: boolean`, `clientDisplayName?: string`; route uses `applyInviteSettings(existingParsed, parsed, new Date())`.
- Page passes `autoInvite`, `clientDisplayName` (prefill tenant name when empty), `inviteStats`, and template status per template: `"approved" | "pending" | "missing" | "no_whatsapp" | "error"` (live read, try/catch).
- Copy keys under `documentsUi.invite`: `title, toggle, toggleHint, displayName, displayNameHint, templates, status{approved,pending,missing,no_whatsapp,error}, notApprovedWarning, stats{invited,started,waiting,handedOff,stopped}, testModeNote`.

- [ ] Step 1: Implement.
- [ ] Step 2: `npm run typecheck && npm run lint && npm test` → PASS.
- [ ] Step 3: Run dev server on 3001, open `/settings/documents`, toggle on, save, reload: toggle persists, display name persists, other settings unchanged.
- [ ] Step 4: Commit `feat(documents): auto-invite switch in Documents settings`.

### Task 7: Ship

- [ ] `npm test`, `npm run typecheck`, `npm run lint` green; revert `tsconfig.tsbuildinfo`.
- [ ] Push, open PR off `main` listing production steps: apply migration (`npm run db:verify:production` / `db:migrate:production`), submit templates per tenant with `scripts/invite-templates.ts submit <tenantId>`, capture a real quick-reply webhook payload on a test phone before turning the switch on.
