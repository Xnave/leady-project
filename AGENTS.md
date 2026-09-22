# AGENTS.md

Guidance for coding agents (Cursor, Claude Code, Codex, etc.) working in this repo.

Human-oriented architecture: [docs/architecture.md](docs/architecture.md). Commands and conventions also live in [CLAUDE.md](CLAUDE.md) — keep them consistent when you change either.

---

## What this product is

Leady is a **multi-tenant messaging CRM**. A lead messages on WhatsApp/Instagram (or `/demo`); an agent replies by walking **JSON flow** on `Agent.flow`. Postgres is the source of truth. There is **no** LangGraph / Temporal graph runtime for turns.

Transactional verticals (visits, stays, fittings, rentals) share one primitive: **`Request`** + HITL `request_approval`. Per-tenant behavior is **`CapabilityInstance.config`**, not new schema columns.

---

## Read these first (in order)

1. [docs/architecture.md](docs/architecture.md) — map, important files, LLM vs rails, how to add capabilities.
2. [src/lib/flow/capabilities/README.md](src/lib/flow/capabilities/README.md) — register hooks / OCP rules.
3. [src/lib/flow/architecture.test.ts](src/lib/flow/architecture.test.ts) — executable architecture contract (“kernel purity”, one Request, instances).
4. [prisma/schema.prisma](prisma/schema.prisma) — `CapabilityInstance`, `Request`, `Agent.flow`.

Then the file you are changing.

---

## Non-negotiable rules

| Rule | Detail |
|---|---|
| **Closed kernel** | Do not put booking/reservation/domain names or logic in `interpreter.ts`. Use capability `reconcile` / tools / effects. |
| **One Request primitive** | Do not add `Meeting` / `Reservation` tables, parallel decide routes, or a second decision form. Use `src/lib/requests.ts`. |
| **Config in instances** | Do not add Tenant columns for vertical config. Use `CapabilityInstance`. |
| **One port wiring site** | Wire `InterpreterPorts` only in `run-turn.ts`. Inngest calls `runTurnNow`. |
| **No prisma in capability packs** | Capabilities call domain modules (`meetings.ts`, `reservations.ts`, `requests.ts`). |
| **Tenant scope** | Every DB read/write filters `tenantId` from `requireTenantId()`. |
| **i18n split** | Lead text → `src/lib/copy/`; operator UI → `src/lib/ui/`. Touch both `en` and `he`. |
| **Nudges** | `runTurnNow` only *returns* `nudgeEvent`. Inngest sends it; direct callers must `dispatchNudgeEvent()`. See [docs/nudges.md](docs/nudges.md). |
| **Tests without LLM keys** | Prefer fake ports / heuristics; do not require `OPENAI_API_KEY` in unit tests. |

If a change would violate an `architecture.test.ts` assertion, stop and redesign — that test is the contract.

---

## Where to change what

| Task | Primary files |
|---|---|
| Fix turn / stage bugs | `interpreter.ts`, `run-turn.ts`, `helpers.ts` |
| Talk prompts / tools surface | `llm.ts`, `prompt-builder.ts`, `capabilities/*.ts` |
| Visit booking behavior | `capabilities/booking.ts`, `booking.ts`, `booking-collect.ts`, `meetings.ts` |
| Stay / span behavior | `capabilities/reservations.ts`, `reservation-config.ts`, `reservations.ts` |
| Collect field types | `flow/fields/` |
| Persist approval | `requests.ts` only for structure |
| Inbox / decide UI | `RequestDecisionForm.tsx`, `inbox/page.tsx`, `api/requests/.../decide` |
| Onboard / enable caps | `OnboardWizard.tsx`, `api/onboard`, `catalog.ts`, `capability-instances.ts` |
| Channel send/receive | `conversations.ts`, `channels/`, `zernio.ts`, webhook routes |

---

## Adding a capability (agent checklist)

**Prefer config:** new `CapabilityInstance` + field specs + nouns on existing `booking` / `reservations`.

**If you need a new pack:**

1. `src/lib/flow/capabilities/<id>.ts` → `registerCapability`.
2. Register from `capabilities/index.ts`.
3. Durable submit: `registerAction` + `registerApprovalEffect` (do not hand-roll waiting_human).
4. Extend `CapabilityId` in `catalog.ts` if product should toggle it.
5. Persist via `createRequestWithApprovalTask` / `decideRequest`.
6. Add tests; run `npx vitest run src/lib/flow/architecture.test.ts`.
7. **Do not** edit `interpreter.ts` for domain rules; **do not** add InterpreterPorts fields.

Full narrative: [docs/architecture.md § Adding a new capability](docs/architecture.md#adding-a-new-capability).

---

## LLM vs deterministic (one paragraph)

The **interpreter** always owns stage transitions, HITL gates, allowed talk edges, effect execution, and persistence. The **LLM** (in `llm.ts`) owns wording and *which registered tools to call* on `talk` (and classify/extract/faq/nudge helpers). Capability `tools`’ `execute` functions and `reconcile` hooks veto or fix bad model output. Never “trust the model” to mark a visit confirmed or skip HITL — `book_meeting` / `create_reservation_hold` are code paths that create a pending `Request`.

---

## Commands agents should use

```bash
npm test                              # all unit tests
npx vitest run src/lib/flow/architecture.test.ts
npx vitest run src/lib/flow/interpreter.test.ts
npm run typecheck
npx prisma db push && npx prisma generate   # after schema changes
```

Dev: `npm run dev` (demo turn is sync; Inngest only for nudges).

---

## Common pitfalls

- Forking booking into a third vertical table instead of `Request` + instance config.
- Putting `enforceX` logic back into the interpreter.
- Wiring a new port in Inngest *and* `run-turn.ts` (Inngest must stay a thin wrapper).
- Forgetting `dispatchNudgeEvent` on demo / HITL resume paths.
- Mixing `copy` and `ui` strings.
- Assuming `Tenant.venueHours` / `reservationConfig` still exist — they moved to instances.

---

## Doc index

| Doc | Audience |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Humans + agents — current architecture |
| [CLAUDE.md](CLAUDE.md) | Claude Code — commands + short architecture |
| [docs/nudges.md](docs/nudges.md) | Silence reminders (Inngest cancelOn, last-lead clock) |
| [docs/conversation-lifecycle.md](docs/conversation-lifecycle.md) | When to close / reopen / create a thread |
| [docs/agent-runtime.md](docs/agent-runtime.md) | Turn/runtime design notes |
| [docs/agent-flow-as-data.md](docs/agent-flow-as-data.md) | Flow JSON rationale |
| [docs/agent-state-flow-concurrency.md](docs/agent-state-flow-concurrency.md) | Concurrency / state |
| [src/lib/flow/capabilities/README.md](src/lib/flow/capabilities/README.md) | Capability OCP cheat sheet |
