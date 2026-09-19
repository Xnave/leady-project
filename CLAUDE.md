# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Next dev server on :3000
npm run build            # prisma generate && next build
npm run typecheck        # tsc --noEmit
npm run lint             # next lint
npm test                 # vitest run (node env, src/**/*.test.ts)
npm run test:watch
npx vitest run src/lib/flow/interpreter.test.ts   # single test file
npx vitest run -t "restart policy"                # single test by name

npm run db:push          # prisma db push (schema → dev DB)
npm run db:migrate       # prisma migrate dev
npm run db:generate      # prisma generate
npm run db:seed          # tsx prisma/seed.ts — creates the dev tenant/agent/channel

npm run proxy            # ngrok tunnel, prints NEXT_PUBLIC_APP_URL (needs NGROK_AUTHTOKEN)
npm run proxy:stop
npm run proxy:status
npx inngest-cli@latest dev   # only needed for delayed nudges
```

First-time setup: `npm install && npx prisma db push && npx prisma generate && npm run db:seed`, then `/demo`.

`npm run dev` alone covers most work — the demo route runs turns synchronously, so Inngest is not required unless testing nudges.

## Architecture

Multi-tenant agent CRM. A lead messages on WhatsApp/Instagram (via Zernio) or the in-app demo chat; an agent answers by walking a **JSON flow** stored on the agent row. Postgres is the source of truth for conversation state — there is no graph framework. Design rationale lives in `docs/agent-runtime.md`, `docs/agent-flow-as-data.md`, `docs/agent-state-flow-concurrency.md`.

### Flow-as-data + the ports pattern (the core abstraction)

`src/lib/flow/interpreter.ts` is a **pure state machine**. It reads `agent.flow` (a `FlowDefinition` of `classify` / `collect` / `faq` / `talk` / `action` / `terminal` stages), decides what happens this turn, and performs every side effect through an injected `InterpreterPorts` object — never by importing the DB, the LLM, or a channel directly. That is what makes it unit-testable.

`src/lib/flow/run-turn.ts` → `runTurnNow()` is the **single** place those ports are wired. `src/inngest/functions.ts` → `runAgentTurn` does not re-wire them; it wraps `runTurnNow()` in `step.run(...)` for durability/retries and forwards the returned nudge event via `step.sendEvent`. Real inbound webhooks go through `enqueueAgentTurn()`; the demo chat and ops preview call `runTurnNow()` directly.

**When adding a port, `run-turn.ts` is the only file to change.** Only touch `src/inngest/functions.ts` if the turn needs a new durable step or a new event.

Because nudge scheduling is split (the port records the event, the Inngest wrapper sends it), callers that invoke `runTurnNow()` directly must send the returned `nudgeEvent` themselves — `dispatchNudgeEvent()` in `run-turn.ts` does this.

Turn ordering is protected by `concurrency: [{ key: "event.data.conversationId", limit: 1 }]` on `runAgentTurn`.

### Capabilities, instances, and requests

The interpreter names no business domain. Transactional behavior is a registered **capability** (`booking`, `reservations`) attached on the talk stage. Per-tenant configuration is a **`CapabilityInstance`** row (field schema, nouns, templates, availability) — adding a business type is an insert, not a Tenant column and not a deploy. Every approval vertical persists as one **`Request`** with a normalized `startAt`/`endAt` time spine; collect/confirm/HITL live in `src/lib/requests.ts`. Field *types* (`date`, `date_range`, `datetime_text`, `enum`, …) live in `src/lib/flow/fields/` so a new vertical is a JSON array of specs.

`architecture.test.ts` ("kernel purity", "one request primitive", "config lives in capability instances") fails if a domain name creeps back into the interpreter or a second table/route/form appears.

### Flow config is validated on write, versioned, and never hand-edited at runtime

`POST /api/ops/agent` rebuilds the flow from a catalog template (`src/lib/flow/catalog.ts` — `inbox` / `faq`, with `book` accepted as a legacy alias for inbox + proactive booking stance), runs `validateFlow()` (`src/lib/flow/validate.ts`, throws `FlowConfigError`), then in one transaction writes an `AgentConfigRevision` and bumps `agent.flowVersion`. Scheduled nudges carry the `flowVersion` they were created under and skip themselves as `stale-flow` when the agent has since changed. Owners never see a flow builder; ops picks a catalog and toggles policy.

### Tenant isolation

`requireTenantId()` (`src/lib/tenant.ts`) is the single entry point, and every Prisma query must filter on the `tenantId` it returns — including `findFirst`/`findUnique` lookups by id. Resolution order:

1. Admin impersonation cookie (`src/lib/admin.ts`, HMAC-signed session + tenant cookie) — "act as tenant".
2. `DEV_AUTH_BYPASS=true` → `DEV_TENANT_ID`, or the first tenant in the DB.
3. Clerk `orgId` → `tenant.clerkOrgId`.

Channel access tokens and HMAC secrets are stored encrypted (AES-256-GCM, `src/lib/crypto.ts`, `APP_ENCRYPTION_KEY` = 32-byte hex).

### LLM providers

`src/lib/flow/model.ts` picks the first configured provider: OpenAI (`OPENAI_CHAT_MODEL`, default `gpt-4o-mini`) → Gemini → Anthropic, all through the Vercel AI SDK. **With no key at all the app still runs** — `llmConfigured()` is false and classify/extract fall back to heuristics, which is why tests need no keys.

That file re-reads `.env` from disk on every `env()` call by design: Next inlines `process.env.X` at compile time and would otherwise bake in an empty string. Keep the bracket-access + hydrate pattern when adding a provider key.

### Inbound message path

`POST /api/webhooks/zernio` verifies the optional `X-Zernio-Signature` HMAC, resolves the channel by `providerExternalId`, calls `persistInboundIfNew()` (idempotent on `tenantId_providerMessageId`), then `enqueueAgentTurn()` and ACKs fast. `/api/dev/inbound` and `/api/demo/message` are the local equivalents, the latter running the turn inline.

### Two separate i18n layers (en/he)

- `src/lib/copy/` — text and prompts the **lead** sees. Language per turn comes from `resolveReplyLanguage(tenant.chatLanguage, lastCustomerText)`, so a `multi` tenant mirrors the customer's language.
- `src/lib/ui/` — text the **CRM operator** sees, chosen by the `/api/ui/lang` cookie.

Do not mix them; adding customer-facing wording means touching both `copy/en.ts` and `copy/he.ts`.

## Conventions

- Import via the `@/` alias (`@/lib/...`), aliased in `tsconfig.json` and again in `vitest.config.ts`.
- Tests sit next to their subject as `*.test.ts` and cover flow validation and the interpreter; test the interpreter by passing fake ports rather than mocking modules.
- `next.config.ts` pins `outputFileTracingRoot` to this directory — a parent `~/yarn.lock` otherwise makes Next treat `~` as the app root and skip this project's `.env`.
