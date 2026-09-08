# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Leady — multi-tenant agent CRM on Next.js 15 (App Router) + Prisma/Postgres. Leads message over WhatsApp/Instagram (via Zernio) or the in-app chat preview; a JSON flow interpreted in-process drives replies, extracts lead fields, requests meetings, and pauses for a human.

Design docs (read before changing runtime behavior): `docs/agent-runtime.md`, `docs/agent-flow-as-data.md`, `docs/agent-state-flow-concurrency.md`.

Owner-facing CRM gaps and the prioritized backlog: `docs/crm-gaps.md`.

## Commands

```bash
npm run dev              # next dev on :3000
npm run build            # prisma generate + next build
npm test                 # vitest run (src/**/*.test.ts, node env)
npx vitest run src/lib/flow/interpreter.test.ts     # single file
npx vitest run -t "name of test"                    # single test by name
npm run typecheck        # tsc --noEmit
npm run lint             # next lint
npm run db:push          # prisma db push (dev schema sync)
npm run db:seed          # tsx prisma/seed.ts — creates dev tenant + agent + local demo channel
npx inngest-cli@latest dev   # only needed for delayed nudges / webhook-driven turns
npm run proxy            # ngrok tunnel for public HTTPS webhooks (proxy:stop / proxy:status)
```

First run: `npm install && npx prisma db push && npx prisma generate && npm run db:seed && npm run dev`, then open `/demo`.

## Architecture

### Turn pipeline

Inbound message → persist → run a turn. Two entry paths, **one interpreter**:

- `POST /api/webhooks/zernio` and `POST /api/webhooks/meta` verify signature, `persistInboundIfNew`, then `enqueueAgentTurn` → Inngest event `agent/turn.requested` → `src/inngest/functions.ts`.
- `POST /api/demo/message` (chat preview) calls `runTurnNow` in-process so the UI can await the reply.

Both build the same `InterpreterPorts` and call `interpretTurn` (`src/lib/flow/interpreter.ts`). The Inngest path wraps each port in `step.run` for durability/retries; the in-process path calls the same functions directly (`src/lib/flow/run-turn.ts`). **When you add a port, add it to both.**

`runAgentTurn` has `concurrency: [{ key: "event.data.conversationId", limit: 1 }]` — one turn per conversation at a time. Idempotency is `messages` unique `(tenantId, providerMessageId)`; `persistInboundIfNew` returns `null` on P2002.

### Flow as data (not LangGraph)

`agents.flow` is a JSON `FlowDefinition` (`src/lib/flow/types.ts`): `start`, `restartPolicy`, `stages`. Stage types: `classify`, `collect`, `faq`, `talk`, `action` (`book_meeting` | `request_human`), `terminal`. `conversations.flowState` is the cursor; `leads.fields` (JSONB) is the fact bag.

The interpreter loops up to 8 hops per turn, persisting stage/fields as it goes, then returns after sending one reply. Deliberately no graph library, no checkpointer, no in-memory session — every turn reloads context from Postgres via `loadTurnContext`.

`src/lib/flow/catalog.ts` is the only flow author in the product today: three catalog ids (`inbox`, `book`, `faq`) all compile to a single-`talk`-stage flow with `escalate`/`done`/`waiting_human` terminals. `classify`/`collect`/`faq` stages are supported by the interpreter and tested but not produced by the catalog. Owners never edit JSON — three call sites build flows via `flowForCatalog`: `prisma/seed.ts`, `POST /api/onboard` (the `/onboard` wizard, which also writes tenant intro/venue/booking templates), and `POST /api/ops/agent` (the `/ops` screen, catalog id + HITL/restart toggles). All three must `validateFlow` before writing.

`validateFlow` (`src/lib/flow/validate.ts`) enforces reachability, no dead ends, `collect`/`required_for_book` fields exist in `leadSchema`, and that `request_human` stages are allowed by `hitlPolicy`. Every flow save must pass it. Saves bump `flowVersion` and insert an `AgentConfigRevision` row in one transaction; never mutate old revisions.

### LLM

`src/lib/flow/model.ts` picks provider by key precedence: OpenAI (`OPENAI_CHAT_MODEL`, default `gpt-4o-mini`) → Gemini → Anthropic. It re-reads `.env` from disk on every access because Next inlines `process.env.X` at compile time — read env through its `env()` helper, not bare `process.env`, for those keys.

`llmConfigured()` gates every LLM call in `src/lib/flow/llm.ts`; with no key the code falls back to deterministic heuristics (Hebrew/English canned copy), which is what most tests exercise. Keep that fallback path working when adding LLM steps.

### Multi-tenancy and auth

`requireTenantId()` (`src/lib/tenant.ts`) resolves, in order: admin impersonation cookie → `DEV_AUTH_BYPASS=true` + `DEV_TENANT_ID` (or first tenant) → Clerk `orgId` → `Tenant.clerkOrgId`. **Every query must be scoped by `tenantId`** — every model carries it, and routes use `findFirst`/`findFirstOrThrow` with `{ id, tenantId }` rather than `findUnique`.

Platform admin (`/admin`, `src/lib/admin.ts`) is an HMAC cookie over `ADMIN_SECRET`; it can create tenants and set the `leady_tenant_id` cookie to act as one. `DEV_AUTH_BYPASS` opens admin locally.

### Channels

`ChannelConnection` is `(provider, providerAccountId)` unique, holds `accessTokenEnc`/`hmacSecretEnc` (AES via `src/lib/crypto.ts`, key `APP_ENCRYPTION_KEY`), and points at one `Agent`. Outbound goes through `sendOnChannel` (`src/lib/channels/meta.ts`), which routes to Zernio's inbox API when a `zernioConversationId` is stored on the lead. Zernio is the live path (`src/lib/zernio.ts`, `src/lib/channels/zernio-*.ts`); HookMyApp (`src/lib/hookmyapp.ts`, `/api/hookmyapp/*`) is legacy and mostly unused.

### HITL and meetings

`request_human` → `pauseForHuman` sets `conversations.status = "waiting_human"` and creates a `HitlTask`. While `waiting_human`, `interpretTurn` persists the inbound and returns immediately unless the event carries `resume: true`. `/inbox` + `POST /api/hitl/[id]/complete` resume. The owner can also take over directly: `POST /api/leads/[id]/bot` mutes/unmutes the agent on a conversation (same `waiting_human` state) and `POST /api/leads/[id]/reply` sends the owner's own text over the channel as a `human` message (`src/lib/human-reply.ts`). `book_meeting` → `requestTentativeMeeting` creates a pending `Meeting`; the owner decides at `/api/meetings/[id]/decide`, which sends the tenant's approved/rejected template.

### i18n (two separate systems)

- `src/lib/ui/*` — dashboard chrome, `he` (default) / `en`, chosen by the `leady_ui_lang` cookie, `dir` set in `src/app/layout.tsx`.
- `src/lib/copy/*` — customer-facing chat copy and prompt text. Language per turn comes from `Tenant.chatLanguage` (`multi` | `he` | `en`); `multi` mirrors the lead's script (`looksHebrew`).

Do not hardcode user-visible strings — add keys to both `en.ts` and `he.ts` of the relevant module.

### Dev-only endpoints

Gated on `DEV_AUTH_BYPASS === "true"`, 403 otherwise: `POST /api/dev/inbound` simulates an inbound message on the first enabled channel and runs the turn synchronously; `GET /api/dev/llm` reports whether any LLM key is visible to the server. `/api/webhooks/meta` also skips HMAC verification under that flag when no signature header is present.

## Deployment

VPS + nginx; see `nginx/leady-ssl.example.conf`. Public HTTPS in dev is ngrok (`npm run proxy`) — set `NEXT_PUBLIC_APP_URL` to the printed URL and restart dev, or `NGROK_DOMAIN` for a stable one.

## Conventions

- `@/*` maps to `src/*` (tsconfig + vitest alias).
- Pages are server components reading Prisma directly; mutations are plain HTML forms POSTing to `/api/*` routes that `redirect` back. Use `redirectPath(req, ...)` (`src/lib/request-url.ts`) rather than building absolute URLs — it keeps local dev off `NEXT_PUBLIC_APP_URL`.
- Styling is one hand-written `src/app/globals.css` with CSS variables and semantic class names. No Tailwind, no CSS modules.
- Tests are pure unit tests on `src/lib` with fake ports/contexts — no DB, no network. Follow that shape: to test flow behavior, build a `TurnContext` and stub `InterpreterPorts`.
