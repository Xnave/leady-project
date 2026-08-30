# Agent runtime: async messaging, multi-tenancy, HITL

This document describes how Leady should run agents. It is the implementation guide for the v1 architecture: **one tool-calling loop**, **Postgres as the source of truth**, **Inngest for async turns**, **ops-configured agents per tenant**.

It also explains why this is preferred over LangGraph, Temporal, CrewAI, and similar stacks for *this* product.

---

## What we are actually building

Leady is not a chat app with a streaming sidebar. It is **async, multi-channel, multi-tenant messaging**:

- A lead sends a WhatsApp or Instagram message (later: a phone call).
- Meta/HookMyApp delivers a webhook. We must ACK quickly.
- Minutes or hours may pass between turns. There is no live WebSocket to the lead.
- The same conversation may pause for a human (approve a quote, read a photo, fill a missing field).
- Each business owner (tenant) has their own channels, leads, and one or more agents. Data must never leak across tenants.
- Most agents are simple: collect info, answer from FAQs, book a meeting. Complexity is **JSON flow data** on the agent (`agents.flow` + `conversations.flow_state`), interpreted by one Inngest function — not LangGraph. See [agent-flow-as-data.md](./agent-flow-as-data.md). Optional n8n is a side-effect after the flow, not the messenger. Leady ops edits JSON; owners do not get a workflow builder.

That last point drives the stack. We need a **durable conversation plus a small JSON state machine**, not a compiled graph framework.

```
Lead message  →  webhook (ACK)  →  Inngest job  →  LLM + tools  →  outbound send
                                                      ↓
                                               DB: leads, messages, HITL
```

---



## Core choice: conversation state in the database, not in the framework


| Concern                     | Where it lives                                                          |
| --------------------------- | ----------------------------------------------------------------------- |
| What was said               | `messages` rows                                                         |
| What we know about the lead | `leads.fields` JSONB                                                    |
| Whether the bot may speak   | `conversations.status` (`open` / `waiting_human` / `closed`)            |
| Who this traffic belongs to | `tenant_id` on every row + Clerk org                                    |
| Which brain to run          | `channel_connections.agent_id` → `agents` row (prompt, `flow` JSON, FAQ) |
| Where we are in the script  | `conversations.flow_state` + `leads.fields` (interpreter, not the LLM) |
| In-flight work / retries    | Inngest event + idempotency key (`wamid` / IG message id)               |


The agent is a **function over that state**:

1. Load tenant, agent config, conversation, last N messages, lead fields.
2. If status is `waiting_human`, persist the inbound message and stop.
3. Call the model with tools until it produces a user-facing reply (or a HITL pause).
4. Persist assistant/tool messages, update lead fields, send on the same channel.

There is no checkpointed graph, no in-memory session, no long-lived process per chat.

---



## Why not LangGraph (and friends)



### LangGraph

LangGraph is a **state machine for LLM apps**: nodes, edges, reducers, checkpointers, interrupt/resume. It shines when:

- The product *is* a complex, branching workflow you want to inspect as a graph.
- You need first-class interrupts inside a multi-node pipeline.
- A team is already standardized on LangChain.

For Leady it is the wrong default:

- **WhatsApp/IG turns are already the graph.** Each inbound message is a new job. Edges are “the lead replied” or “the owner approved,” which are *external events*, not LangGraph edges. Modeling that as a graph duplicates the conversation table.
- **HITL is a CRM queue, not a graph interrupt.** LangGraph `interrupt()` pauses a thread in the checkpointer. Our pause must be visible in the owner dashboard, assignable, and resumable days later from a different process. That is a `hitl_tasks` row + `waiting_human`, not a pickled graph state.
- **Multi-tenancy is data isolation, not graph config.** LangGraph does not give you RLS, per-channel HMAC secrets, or HookMyApp tokens. You would still build all of that, then wrap it in a graph.
- **Ops-configured simple agents.** Most tenants are a short JSON flow (classify → collect → action). Complex tenants get a longer JSON graph. **Same Inngest interpreter.** n8n is optional after `done`, not a second orchestrator.
- **TypeScript product.** The app is Next.js. Vercel AI SDK’s `generateText` + `tools` is the same idea as LangGraph’s tool node, without a second Python service or LangChain lock-in.
- **Debugging.** “Replay this `conversation_id` from `messages`” is easier than “inspect the checkpointer for thread X.”

Do not adopt LangGraph as the platform. If a tenant needs more stages, add them to `agents.flow` JSON. If they need a new *kind* of stage, add one `stage.type` to the interpreter.

### Other options, briefly


| Approach                                          | What it is good at                                              | Why not as Leady’s core                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Raw LangChain agents**                          | Batteries for tools/RAG                                         | Heavy abstraction; still no CRM/tenancy; Python-centric                                                                                                                                      |
| **CrewAI / AutoGen / multi-agent**                | Role-playing swarms                                             | We need *one* customer-facing agent per channel, not a debate club. Extra agents = extra cost and racey sends                                                                                |
| **Temporal / Cadence**                            | Multi-day workflows with timers, sagas, exactly-once activities | Correct but heavy for “LLM turn + tools.” HITL wait of “owner clicks Approve” is a new event, not a workflow sleep. Revisit if we have many durable timers (drip campaigns, SLA escalations) |
| **n8n / Make as the agent**                       | Visual ops, integrations                                        | Fine as an **escape hatch tool** (`run_n8n_workflow`). Bad as the messenger: prompt iteration, tool calling, and message history are clumsy; every tenant workflow becomes a snowflake       |
| **OpenAI Assistants / threads API**               | Hosted threads + tools                                          | Tenant data and HITL live on OpenAI’s thread store; hard to show a first-party CRM, export, or RLS. Provider lock-in                                                                         |
| **Mastra / custom “agent OS”**                    | Typed TS agents                                                 | Overlap with AI SDK; extra framework before we have product-market fit                                                                                                                       |
| **Inngest / Trigger.dev alone (no LLM SDK)**      | Jobs                                                            | Necessary for async, not sufficient for tool calling                                                                                                                                         |
| **Vercel AI SDK + Inngest + Postgres** (this doc) | One turn, durable records, TS                                   | Matches async channels, tenancy, and HITL without a second orchestration product                                                                                                             |


**Rule of thumb:** orchestration frameworks earn their keep when *the framework’s state machine is the product*. Here the product is **inbox + lead record**. Keep orchestration thin.

---



## Async messaging



### Constraints from Meta / HookMyApp

- Webhooks can retry. Processing must be **idempotent** on provider message id.
- Respond to the HTTP request fast (verify signature, persist, enqueue). Do **not** call the LLM in the webhook handler.
- Outbound replies go through HookMyApp’s gateway with a **per-channel** `hmat_` token.
- Conversations are turn-based and slow. Load history from DB every turn; do not keep an agent “session” in RAM.



### Suggested flow

```ts
// app/api/webhooks/meta/route.ts (sketch)
export async function POST(req: Request) {
  const raw = await req.text();
  const payload = JSON.parse(raw);

  const connection = await resolveChannel(payload); // phone_number_id / IG account
  if (!connection) return new Response("unknown channel", { status: 404 });

  if (!verifyHookMyAppHmac(raw, req.headers.get("X-HookMyApp-Signature-256"), connection.hmacSecret)) {
    return new Response("bad signature", { status: 401 });
  }

  const inbound = extractInboundMessages(payload); // wamid / ig mid, from, text, media

  for (const msg of inbound) {
    const inserted = await persistInboundIfNew({
      tenantId: connection.tenantId,
      channelId: connection.id,
      providerMessageId: msg.id,
      from: msg.from,
      text: msg.text,
      media: msg.media,
    });
    if (!inserted) continue; // duplicate webhook

    await inngest.send({
      name: "agent/turn.requested",
      data: {
        tenantId: connection.tenantId,
        conversationId: inserted.conversationId,
        triggerMessageId: inserted.messageId,
      },
      id: `turn-${msg.id}`, // Inngest idempotency
    });
  }

  return new Response("ok", { status: 200 });
}
```

`persistInboundIfNew` creates the lead (unique `(tenant_id, channel, external_user_id)`), appends a `messages` row, and uses a unique index on `provider_message_id` so retries no-op.

### One Inngest function: `runAgentTurn`

```ts
// inngest/functions/run-agent-turn.ts
export const runAgentTurn = inngest.createFunction(
  {
    id: "run-agent-turn",
// Consistency under concurrency
// If the same customer sends two messages in quick succession (e.g., double-tap on WhatsApp), you // need to guarantee the second run sees the first run's result, not a stale read. This is where // Inngest's per-key concurrency comes in (see point 3) — you'd set concurrency limit 1 keyed by // conversation_id, so message-processing steps for the same conversation are serialized even 
// though the platform is otherwise fully parallel.

    // One in-flight turn per conversation; later messages wait.
    concurrency: [{ key: "event.data.conversationId", limit: 1 }],
    retries: 3,
  },
  { event: "agent/turn.requested" },
  async ({ event, step }) => {
    const { tenantId, conversationId } = event.data;

    const ctx = await step.run("load-context", () => loadTurnContext(tenantId, conversationId));

    if (ctx.conversation.status === "waiting_human" && event.data.resume !== true) {
      return { skipped: "waiting_human" };
    }

    const result = await step.run("llm-tools", () => runLlmTurn(ctx));

    if (result.kind === "reply") {
      await step.run("send", () => sendOnChannel(ctx.connection, ctx.lead.externalUserId, result.text));
      await step.run("persist-assistant", () => insertMessage({ ... ctx, role: "agent", text: result.text }));
    }

    return result;
  },
);
```

Concurrency keyed on `conversationId` prevents two jobs from interleaving replies (double-texting the lead). New inbound messages while a turn is running queue behind it; the next job sees the extra `messages` rows.

Do **not** put the LLM call and the WhatsApp send in the webhook. If the model is slow or OpenAI/Anthropic blips, Meta will retry the webhook and you risk duplicate sends unless you are extremely careful. Inngest + unique `wamid` is the simpler contract.

### History window

Load the last ~30 messages plus a compact snapshot of `leads.fields` in the system prompt. That is enough for gathering info and booking. Summarize only if a thread gets huge (later). Skip a vector store until FAQs no longer fit on `agents.knowledge_text`.

---



## Multi-tenancy



### Isolation model

- Clerk **organization** = Leady **tenant**.
- Every table has `tenant_id`. Postgres **RLS** using the org id from the session (or a worker role that sets `SET LOCAL app.tenant_id`).
- HookMyApp: **one customer workspace per tenant**. Owners connect WhatsApp/IG via an onboarding link. Store channel id, phone/IG ids, encrypted gateway token, HMAC secret on `channel_connections`.
- One public webhook URL. Tenant is resolved from the channel identifiers in the payload, then HMAC is verified with **that row’s** secret — never a global secret.

```ts
async function resolveChannel(payload: MetaWebhook): Promise<ChannelConnection | null> {
  const phoneNumberId = payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  const igAccountId = /* similarly for Instagram */;
  if (phoneNumberId) {
    return db.channelConnections.findFirst({ where: { provider: "whatsapp", providerAccountId: phoneNumberId } });
  }
  if (igAccountId) {
    return db.channelConnections.findFirst({ where: { provider: "instagram", providerAccountId: igAccountId } });
  }
  return null;
}
```

Outbound send must use `connection.accessToken` from the same row:

```ts
await fetch(`${connection.apiBase}/v22.0/${connection.providerAccountId}/messages`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${connection.accessToken}`, // hmat_… for this channel only
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    to: leadPhoneE164,
    type: "text",
    text: { body: text },
  }),
});
```



### Agent-per-tenant (one or more)

```sql
agents (
  id, tenant_id,
  name,
  system_prompt,
  knowledge_text,          -- FAQs; not a vector index in v1
  enabled_tools text[],    -- e.g. {update_lead_fields, book_meeting, request_human}
  media_analysis boolean,  -- AND tenants.media_analysis_enabled
  n8n_webhook_url,         -- optional escape hatch
  hitl_policy jsonb        -- when to force request_human
)

channel_connections (
  ...,
  agent_id  -- which agent answers this number / IG account
)
```

Ops edits `system_prompt` and `enabled_tools`. The runtime does not branch on tenant beyond “load this agent row and register those tools.” Complex tenants get extra tools (see below), not a second orchestrator.

Worker jobs must pass `tenantId` explicitly and query with it (defense in depth even with RLS):

```ts
const agent = await db.agents.findFirst({
  where: { id: connection.agentId, tenantId },
});
```

---



## The LLM loop (Vercel AI SDK)

One helper. Tools close over `tenantId` so they cannot write another tenant’s rows.

```ts
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

export async function runLlmTurn(ctx: TurnContext) {
  const tools = buildTools(ctx); // only names in ctx.agent.enabledTools

  const { text, steps } = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    system: buildSystemPrompt(ctx.agent, ctx.lead),
    messages: toModelMessages(ctx.messages),
    tools,
    stopWhen: stepCountIs(8),
  });

  await persistToolTraces(ctx, steps);

  if (ctx.conversation.status === "waiting_human") {
    return { kind: "paused" as const };
  }

  return { kind: "reply" as const, text };
}

function buildTools(ctx: TurnContext) {
  const all = {
    update_lead_fields: tool({
      description: "Merge structured facts extracted from the lead into the CRM record.",
      inputSchema: z.object({
        fields: z.record(z.string(), z.unknown()),
      }),
      execute: async ({ fields }) => {
        await db.leads.update({
          where: { id: ctx.lead.id, tenantId: ctx.tenantId },
          data: { fields: { ...ctx.lead.fields, ...fields } },
        });
        ctx.lead.fields = { ...ctx.lead.fields, ...fields };
        return { ok: true, fields: ctx.lead.fields };
      },
    }),

    book_meeting: tool({
      description: "Offer or confirm a Cal.com booking for this tenant.",
      inputSchema: z.object({
        slotStartIso: z.string(),
        attendeeEmail: z.string().email().optional(),
        attendeeName: z.string().optional(),
      }),
      execute: async (input) => bookOnCalcom(ctx.tenantId, ctx.lead, input),
    }),

    request_human: tool({
      description:
        "Pause automation and ask the business owner to review, approve, or provide info. Use when policy requires a human or you cannot proceed.",
      inputSchema: z.object({
        type: z.enum(["more_info", "approve", "review_media"]),
        reason: z.string(),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async (input) => pauseForHuman(ctx, input),
    }),

    analyze_media: tool({
      description: "Analyze an image or document the lead sent. Only if the tenant paid for this feature.",
      inputSchema: z.object({ mediaId: z.string() }),
      execute: async ({ mediaId }) => {
        if (!ctx.tenant.mediaAnalysisEnabled || !ctx.agent.mediaAnalysis) {
          return { ok: false, error: "media_analysis_not_enabled" };
        }
        return analyzeLeadMedia(ctx, mediaId);
      },
    }),

    run_n8n_workflow: tool({
      description: "Run this tenant's custom n8n workflow. Ops-only; not shown unless enabled.",
      inputSchema: z.object({ payload: z.record(z.string(), z.unknown()) }),
      execute: async ({ payload }) => {
        if (!ctx.agent.n8nWebhookUrl) return { ok: false };
        const res = await fetch(ctx.agent.n8nWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId: ctx.tenantId, leadId: ctx.lead.id, payload }),
        });
        return res.json();
      },
    }),
  };

  return Object.fromEntries(
    Object.entries(all).filter(([name]) => ctx.agent.enabledTools.includes(name)),
  );
}

function buildSystemPrompt(agent: Agent, lead: Lead) {
  return [
    agent.systemPrompt,
    agent.knowledgeText && `## Knowledge\n${agent.knowledgeText}`,
    `## Current lead record\n${JSON.stringify(lead.fields, null, 2)}`,
    "Always persist new facts with update_lead_fields before asking the next question.",
    "You are on WhatsApp/Instagram: keep replies short. Do not mention tools or policies.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
```

Simple vs complex is **which tools are enabled**, not a different engine.

---



## Human-in-the-loop

HITL is a **conversation status + a task row**, not an LLM feature.

```ts
async function pauseForHuman(
  ctx: TurnContext,
  input: { type: "more_info" | "approve" | "review_media"; reason: string; payload?: object },
) {
  await db.$transaction([
    db.hitlTasks.create({
      data: {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversation.id,
        leadId: ctx.lead.id,
        type: input.type,
        reason: input.reason,
        payload: input.payload ?? {},
        status: "open",
      },
    }),
    db.conversations.update({
      where: { id: ctx.conversation.id, tenantId: ctx.tenantId },
      data: { status: "waiting_human" },
    }),
  ]);
  ctx.conversation.status = "waiting_human";
  return { paused: true };
}
```

**While paused:** inbound lead messages are still stored (the owner should see them) but `runAgentTurn` returns `skipped: waiting_human` unless `resume: true`.

**Resume** from the CRM (owner writes a note, approves, or attaches a file):

```ts
async function completeHitlTask(args: {
  tenantId: string;
  taskId: string;
  actorUserId: string;
  resolution: { note: string; approved?: boolean };
}) {
  const task = await db.hitlTasks.update({
    where: { id: args.taskId, tenantId: args.tenantId, status: "open" },
    data: { status: "done", resolution: args.resolution, completedBy: args.actorUserId },
  });

  await db.messages.create({
    data: {
      tenantId: args.tenantId,
      conversationId: task.conversationId,
      role: "human",
      text: args.resolution.note,
      metadata: { hitlTaskId: task.id, approved: args.resolution.approved },
    },
  });

  await db.conversations.update({
    where: { id: task.conversationId, tenantId: args.tenantId },
    data: { status: "open" },
  });

  await inngest.send({
    name: "agent/turn.requested",
    data: {
      tenantId: args.tenantId,
      conversationId: task.conversationId,
      resume: true,
      triggerMessageId: null,
    },
    id: `resume-${task.id}`,
  });
}
```

On resume, the model sees the `human` message in history and continues (thank the lead, send the approved quote, ask the next question). Optional later: WhatsApp template to the *owner* when a task is created — not required for v1.

This maps cleanly to LangGraph-style interrupts **at the product level** (pause, wait for human, resume) without storing graph checkpoints. The “checkpoint” is the conversation.

---



## Idempotency and failure


| Failure                        | Behavior                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate webhook              | Unique `provider_message_id` → no second Inngest event (or event id `turn-{wamid}` dedupes)                                         |
| LLM timeout                    | Inngest retries the **step**. Persist tool results in the same step or use step-level memoization so retries do not re-book Cal.com |
| Send succeeded, persist failed | Prefer: persist assistant message **then** send, or store `provider_send_id` and treat send as idempotent                           |
| HITL then crash                | Status already `waiting_human`; inbound is safe; owner still has the task                                                           |
| Channel token revoked          | Send step fails; surface in ops logs; do not retry forever on 401                                                                   |


Tool side effects that must not double (Cal.com book, n8n POST) should use Inngest `step.run` so a retry of the function does not re-execute a completed step.

---



## What we are not doing in v1

- A visual workflow builder or LangGraph. Flows are JSON + one interpreter.
- Multi-agent “researcher + closer + supervisor” loops on the customer thread.
- OpenAI-hosted threads as the system of record.
- RAG until knowledge outgrows `knowledge_text`.
- A separate Python agent service.

Phone later: Vapi (or similar) writes a `messages` row with `channel = voice` and emits the same `agent/turn.requested` event. The loop above does not change.

---



## Implementation order

1. Persist inbound + outbound without an LLM (echo) to prove HMAC, tenancy, and the transcript UI.
2. `runAgentTurn` with `update_lead_fields` only.
3. `request_human` + CRM inbox + resume.
4. `book_meeting`.
5. Gated `analyze_media`.
6. `run_n8n_workflow` or a TypeScript tool pack for the first complex tenant.

If a future tenant needs a longer script, extend `agents.flow` JSON. Do not invert the platform around LangGraph.