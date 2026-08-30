# State, flow, and concurrency

Companion to [agent-runtime.md](./agent-runtime.md) (runtime) and [agent-flow-as-data.md](./agent-flow-as-data.md) (**JSON flow + Inngest interpreter**, not LangGraph). This doc answers three product questions, then what we would add **if that design is not enough**.

1. **State** — the LLM stays consistent for one conversation.
2. **Flow** — gather the right details, maybe book a meeting, maybe support-first.
3. **Concurrency** — many leads, many tenants, same per-tenant agent, at the same time.

---

## 1. State: consistent answers in one conversation

### What “consistent” means here

Not a frozen personality token. It means:

- The agent does not re-ask for a name it already stored.
- It does not contradict itself (“your meeting is Tuesday” then “we have no slots”).
- It uses this lead’s facts, not another lead’s, and not another tenant’s FAQs.
- After a night of silence, the next WhatsApp still continues the same thread.

The model itself is stateless. **We reconstruct state every turn from Postgres.**

### How this solution does it

Three layers, in order of authority:

| Layer | What | Why the model stays consistent |
|---|---|---|
| **Transcript** | `messages` for this `conversation_id` | The model sees what was actually said. |
| **Lead record** | `leads.fields` JSONB | Canonical facts (name, budget, preferred slot). Prompt says “this is truth; do not invent over it.” |
| **Agent config** | `agents.system_prompt` + `knowledge_text` | Same brain for every lead of this tenant; does not drift per chat. |

Every Inngest job starts from a load, never from RAM:

```ts
const ctx = {
  agent: await loadAgent(tenantId, agentId),
  lead: await loadLead(tenantId, leadId),
  messages: await loadMessages(tenantId, conversationId, { last: 30 }),
};

const { text } = await generateText({
  model,
  system: [
    ctx.agent.systemPrompt,
    ctx.agent.knowledgeText,
    "## Lead record (source of truth)",
    JSON.stringify(ctx.lead.fields),
    "If the transcript and the lead record disagree, trust the lead record and the latest human/HITL note.",
    "Call update_lead_fields whenever the lead states a new fact.",
  ].join("\n\n"),
  messages: toModelMessages(ctx.messages),
  tools: { update_lead_fields, /* ... */ },
});
```

Consistency tactics that matter more than a graph:

- **Write facts out of the chat.** `update_lead_fields` is mandatory in the prompt. The next turn injects JSON, so the model is not relying on a 40-message recap.
- **One conversation per (tenant, channel, external user).** All WhatsApp from `+1555…` to this WABA is one thread. No “new chat” unless you explicitly close and open.
- **HITL notes are `role: human` messages.** Resume includes the owner’s correction (“price is 450, not 400”) so the model aligns.
- **Do not keep an in-process session.** Two Railway replicas must load the same rows and produce the same context.

Temperature stays low for collection/booking agents. Creative copy can live in `system_prompt`, not in sampling chaos.

### If this is not enough

Symptoms: repeats questions, invents fields, forgets a commitment after 15 turns, or two facts fight (transcript vs JSON).

**Escalate in this order:**

1. **Schema, not free JSON.** Define required keys per agent (`name`, `email`, `service`, `slot`). Validate in `update_lead_fields`. Put a computed `missing[]` in the system prompt every turn so the model cannot “forget” the checklist.

```ts
const schema = ctx.agent.leadSchema; // { name: "string", email: "email", ... }
const missing = Object.keys(schema).filter((k) => ctx.lead.fields[k] == null);

system += `\nMissing required fields: ${missing.join(", ") || "none"}`;
```

2. **Running summary row.** When `messages.length > 40`, a cheap model writes `conversations.summary`. Next turn: summary + last 12 messages + `fields`. Stops recap rot without a vector DB.

3. **Pin commitments.** When `book_meeting` succeeds, store `leads.fields.booking = { start, url }` and add a hard line: “If `booking` is set, never offer a different time unless the lead asks to reschedule.”

4. **Only then** a checkpointer (LangGraph / custom reducer). Use it if you need *derived* state that is not lead fields (e.g. “we already ran credit check this turn”). Still persist `messages` + `fields` as the CRM source of truth.

We do **not** solve consistency by putting the whole chat in Redis or in OpenAI Threads. Those hide the CRM and break multi-tenant export.

---

## 2. Flow: gather details, then meet / support / handoff

### What “flow” means here

A sales agent should not jump to Cal.com before email exists. A support agent should try FAQ before `request_human`. Different tenants want different sequences. Ops configures this; owners do not draw a flowchart in v1.

### How this solution does it

Flow is **JSON on the agent + `flow_state` on the conversation + one Inngest interpreter**. Not a prompt-only agent, not LangGraph. Full example: [agent-flow-as-data.md](./agent-flow-as-data.md).

1. **`agents.flow`** — stages (`classify`, `collect`, `faq`, `action`, `terminal`), required fields, transitions. Simple tenant: 2 stages. Complex: longer graph. Same function.
2. **`conversations.flow_state`** — which node we are on. Code moves this; the LLM does not pick the next stage except via a classify step whose output is mapped by `transitions`.
3. **`leads.fields`** — extracted facts. Collect stages refuse to complete until `required_fields` are set. Actions like `book_meeting` only run when the interpreter enters that stage.
4. **LLM inside `step.run`** — classify intent, extract fields, draft the next question, answer FAQ. Rails stay in the interpreter.
5. **Nudges** — `step.sleepUntil` in a *separate* reminder function, not while waiting for the next WhatsApp (that is a new event).

n8n is for *after* the flow (`done` → create a deal), not for “ask name, then email.”

### If this is not enough

Symptoms: JSON cannot express a stage type (e.g. document OCR then branch), or timers become a whole campaign engine.

**Escalate in this order:**

1. Add a new `stage.type` to the **same** interpreter (still data + one function).
2. Inngest `sleepUntil` reminder function for “no reply in 24h” — already in the flow doc; not Temporal.
3. Temporal only if you have many competing timers/sagas per lead. Still no LangGraph.

---

## 3. Concurrent users, concurrent tenants, same agent

### The problem

Tenant Acme’s WhatsApp agent may handle 50 leads at once. Tenant Beta’s Instagram agent runs on the same Railway service. Nothing in-memory should mix them. Two messages from the same lead must not produce two overlapping replies.

### How this solution does it

Concurrency is **isolated by data and by job keys**, not by “one process per agent.”

```
                    Inngest
Tenant A, lead 1 ──► turn (conversation_id = C1)
Tenant A, lead 2 ──► turn (conversation_id = C2)   ← same agent row, parallel
Tenant B, lead 9 ──► turn (conversation_id = C9)
```

**Cross-tenant isolation**

- Every query includes `tenantId` (and RLS).
- Tools close over `ctx.tenantId`. `update_lead_fields` cannot take another tenant’s `leadId` from the model: the id comes from context, not from the tool args.
- Channel tokens are per `channel_connections` row. Send uses that token only.
- Agent prompt/knowledge is loaded by `(tenantId, agentId)`. Acme’s FAQ never enters Beta’s `system` string.

**Cross-lead isolation (same tenant, same agent)**

- Context is keyed by `conversationId`. Lead 1’s `messages` are never in lead 2’s `generateText` call.
- The agent config is **read-only** during a turn. Fifty parallel jobs can share the same `agents` row like sharing a file; they do not share a chat buffer.

**Same-lead isolation (avoid double send)**

```ts
inngest.createFunction(
  {
    id: "run-agent-turn",
    concurrency: [{ key: "event.data.conversationId", limit: 1 }],
  },
  { event: "agent/turn.requested" },
  handler,
);
```

Webhook retries + two quick WhatsApps from one person serialize on that key. The second job sees both inbound messages in `loadMessages`.

**Platform-level**

- Inngest (or the worker pool) scales horizontally; we do not pin “Acme’s agent” to one VM.
- Idempotency: event id `turn-{wamid}` so Meta retries do not start a second LLM call for the same message.
- Unique `(tenant_id, provider_message_id)` on `messages`.

The LLM APIs already accept many parallel `generateText` calls. We need to respect **their** rate limits (queue/retry on 429), not invent a global lock on the agent.

### If this is not enough

Symptoms: mixed names in a reply, double WhatsApp texts, tenant A’s token used for tenant B, or 429 storms.

**Escalate in this order:**

1. **Prove the bug is context, not the model.** Log `{ tenantId, conversationId, leadId }` at the start of every turn; never log another tenant’s payload. Add a test: two parallel `runLlmTurn` with different tenants; assert tools only updated their own `leads` rows.

2. **DB lock on the conversation** if Inngest concurrency is not available:

```ts
await db.$executeRaw`
  SELECT id FROM conversations
  WHERE id = ${conversationId} AND tenant_id = ${tenantId}
  FOR UPDATE`;
```

Hold the lock only around load → LLM → persist → send, or keep it short: lock around persist+send if the LLM is slow (then you need a `turn_in_progress` flag so a second worker exits). Prefer Inngest’s key; `FOR UPDATE` is the fallback.

3. **Per-tenant outbound rate limits** (WhatsApp/HookMyApp quotas). A Redis/Inngest throttle keyed by `channel_id`, not by agent, so one viral tenant cannot starve others on a shared Meta limit — actually Meta limits are per WABA, so throttle **per channel connection**.

4. **Per-tenant LLM budget.** Same idea: Inngest concurrency `{ key: event.data.tenantId, limit: N }` *in addition to* per-conversation `limit: 1`, so one tenant cannot occupy every worker.

5. **Poison isolation.** If a tool pack throws, fail that job only. No global in-memory cache of “current tenant.”

We do **not** run one LangGraph thread server per tenant or a sticky websocket per agent. That model fights serverless and multi-instance deploys.

---

## Mapping: covered vs fallback

| Need | Covered by v1 runtime | If it breaks |
|---|---|---|
| Same chat remembers facts | `messages` + `leads.fields` rehydrated each turn | Field schema + `missing[]`; then summary; then commitments |
| Same chat does not contradict bookings | `book_meeting` writes `fields.booking`; prompt trusts it | Treat booking as immutable without an explicit reschedule tool |
| Collect then book / support first | JSON `agents.flow` + `flow_state` + one Inngest interpreter | New `stage.type`; not LangGraph |
| Long-running “wait 24h” | Separate Inngest nudge + `sleepUntil` | Temporal only for many competing timers |
| Many leads × many tenants | Job per conversation; tenant on every query; tools closed over ctx | `FOR UPDATE`; per-tenant worker caps; per-channel send throttle |
| Two messages from one lead | Inngest concurrency key = `conversationId` | Row lock / `turn_in_progress` |

---

## Short answers

1. **State** — The LLM has no memory. Consistency is **reload this conversation’s messages + lead JSON + this tenant’s agent config** every turn, and **write new facts into JSON** via tools. If that drifts, tighten the schema and missing-fields list before adding a graph.

2. **Flow** — Sequence is **JSON stages** interpreted by Inngest. The LLM extracts and talks; code transitions and runs `book_meeting` / HITL only when the graph says so. See [agent-flow-as-data.md](./agent-flow-as-data.md).

3. **Concurrency** — There is no shared agent session. Parallelism is **one Inngest job per conversation**, many jobs per agent row, strict `tenantId` on reads/writes/sends. Serialize only where double-send would hurt: the same `conversationId`.
