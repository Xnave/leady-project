# Flow as data: JSON + one Inngest interpreter (not LangGraph)

We **do not** use LangGraph. We **do** use an explicit flow: a JSON graph stored on the agent, plus `flow_state` on the conversation. **One generic Inngest function** reads that JSON and walks it.

That is the same *idea* as LangGraph (stages, transitions, required fields) without a graph library, compiled graphs, or a checkpointer. Perplexity’s pattern is the intended design — this doc makes it concrete.

Related: [agent-runtime.md](./agent-runtime.md) (jobs, tools, HITL), [agent-state-flow-concurrency.md](./agent-state-flow-concurrency.md) (why state/concurrency still sit in Postgres).

---



## Why this, not “just prompt the LLM”

History + `leads.fields` keep the model *informed*. They do **not** keep the model *on rails*. Without a flow, it can skip email and “book” in prose, or ask seven questions at once.


| Piece                                                             | Owner                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| What stage we are in                                              | `conversations.flow_state` (code)                                                     |
| What “done” means for this tenant                                 | `agents.flow` JSON (ops data)                                                         |
| Extract name/email from a WhatsApp                                | LLM inside an Inngest `step.run`                                                      |
| Whether we may call [Cal.com](http://Cal.com) (not at this stage) | Interpreter: required fields complete                                                 |
| Wording of the next question                                      | LLM, constrained by the current stage                                                 |
| “No reply in 24h, nudge”                                          | Per-stage `nudge` in JSON → separate Inngest event + `step.sleepUntil` |


LangGraph would compile a TypeScript/Python `StateGraph` per agent and checkpoint node state. We already checkpoint: `flow_state`, `leads.fields`, `messages`. Compiling a second graph is duplicate machinery. JSON on `AgentConfig` lets a simple tenant be two stages and a complex tenant be eight, **same function**.

---



## Data model

```ts
// conversations
flow_state: string; // current stage id
flow_version: number; // agents.flow_version at last transition (detect mid-chat ops edits)

// agents
flow: FlowDefinition;
flow_version: number;
flow_changed_at: timestamptz;
lead_schema: LeadSchema; // canonical keys + types
lead_schema_version: number;
lead_schema_changed_at: timestamptz;
hitl_policy: HitlPolicy;
```

Rollback: keep `agent_config_revisions` (agent_id, kind: flow | lead_schema, version, json, saved_by, saved_at). Saving a flow inserts a revision and bumps `flow_version`. Ops can restore version N by copying JSON back and bumping again (never mutate old revision rows).

`leads.fields` remains the bag of extracted facts. The flow only names which keys are required in which stage — those keys **must** exist in `lead_schema` (enforced on save).

---



## Example flow JSON (intent → collect → book or support)

Ops stores this on the agent. Simple FAQ tenant might only have `answer_support` → `done`. Same interpreter.

```ts
export type LeadSchema = {
  fields: Record<string, { type: "string" | "email" | "enum"; requiredGlobal?: boolean; enum?: string[] }>;
};

export type NudgeSpec = {
  after: string; // ISO-8601 duration, e.g. "PT24H"
  template: string; // outbound copy; no LLM required
  maxTimes?: number; // default 1
};

export type RestartPolicy = {
  /** After a terminal stage, what a *new lead message* does. HITL pause is not this. */
  onNewMessage: "ignore" | "restart" | "fallback";
  /** When fallback: jump to this stage (usually a faq-only node). */
  fallbackStage?: string;
};

export type HitlPolicy = {
  allowRequestHuman: boolean;
  /** Stage ids allowed to run action request_human. Empty = none. */
  allowedFromStages: string[];
  allowedIntents?: string[];
  allowedDocumentTypes?: string[];
  /** If classify/extract confidence is below this, force escalate instead of continuing. */
  minConfidence?: number;
};

export type FlowDefinition = {
  start: string;
  restartPolicy: RestartPolicy;
  stages: Record<string, Stage>;
};

type StageBase = {
  nudge?: NudgeSpec; // non-HITL only; omitted = no reminder
};

export type Stage =
  | (StageBase & {
      type: "classify";
      prompt: string;
      intents: string[];
      transitions: Record<string, string>;
    })
  | (StageBase & {
      type: "collect";
      prompt: string;
      required_fields: string[];
      optional_fields?: string[];
      ask_one_at_a_time?: boolean;
      on_complete: string;
    })
  | (StageBase & {
      type: "faq";
      prompt: string;
      on_resolved: string;
      on_unresolved: string;
    })
  | (StageBase & {
      type: "action";
      action: "book_meeting" | "request_human";
      on_complete: string;
      on_fail: string;
    })
  | (StageBase & { type: "terminal" });

export const salesOrSupportFlow: FlowDefinition = {
  start: "classify_intent",
  restartPolicy: { onNewMessage: "fallback", fallbackStage: "answer_support" },
  stages: {
    classify_intent: {
      type: "classify",
      prompt: "Decide if this person wants to buy/book (sales) or has a product question (support). Default sales if mixed.",
      intents: ["sales", "support"],
      transitions: {
        sales: "collect_lead",
        support: "answer_support",
      },
    },
    collect_lead: {
      type: "collect",
      prompt: "Collect booking details. Be short. One question at a time.",
      required_fields: ["name", "email", "service"],
      optional_fields: ["budget", "time_preference"],
      ask_one_at_a_time: true,
      on_complete: "schedule",
      nudge: {
        after: "PT24H",
        template: "Still happy to help — want to finish booking?",
        maxTimes: 1,
      },
    },
    answer_support: {
      type: "faq",
      prompt: "Answer from Knowledge only. If you cannot, we escalate.",
      on_resolved: "done",
      on_unresolved: "escalate",
    },
    schedule: {
      type: "action",
      action: "book_meeting",
      on_complete: "done",
      on_fail: "collect_lead", // e.g. still missing a slot
    },
    escalate: {
      type: "action",
      action: "request_human",
      on_complete: "waiting_human",
    },
    done: { type: "terminal" },
    waiting_human: { type: "terminal" },
  },
};
```

A simpler tenant:

```json
{
  "start": "collect_lead",
  "stages": {
    "collect_lead": {
      "type": "collect",
      "prompt": "Get name and phone, then we are done.",
      "required_fields": ["name", "phone"],
      "on_complete": "done"
    },
    "done": { "type": "terminal" }
  }
}
```

No new Inngest function. No LangGraph compile.

---



## One Inngest function interprets the JSON

Inbound WhatsApp still only enqueues `agent/turn.requested`. The function loads `agent.flow` and `conversation.flow_state` and **branches in code**.

Important: **do not** `sleepUntil` waiting for the lead’s next message. The next message is a new webhook → new event. Sleep is only for *timeouts* (nudge if silent).

```ts
export const runAgentTurn = inngest.createFunction(
  {
    id: "run-agent-turn",
    concurrency: [{ key: "event.data.conversationId", limit: 1 }],
  },
  { event: "agent/turn.requested" },
  async ({ event, step }) => {
    const ctx = await step.run("load", () => loadTurnContext(event.data));

    if (ctx.conversation.status === "waiting_human" && !event.data.resume) {
      return { skipped: "waiting_human" };
    }

    const flow = ctx.agent.flow as FlowDefinition;
    let stageId = ctx.conversation.flow_state || flow.start;
    let stage = flow.stages[stageId];

    // --- 1. Classify (only if this stage says so) ---
    if (stage.type === "classify") {
      const intent = await step.run("classify", () => classifyIntent(ctx, stage));
      const next = stage.transitions[intent] ?? stage.transitions[stage.intents[0]];
      stageId = await persistStage(ctx, next);
      stage = flow.stages[stageId];
    }

    // --- 2. FAQ / support ---
    if (stage.type === "faq") {
      const faq = await step.run("faq", () => answerFaq(ctx, stage));
      const next = faq.resolved ? stage.on_resolved : stage.on_unresolved;
      await persistStage(ctx, next);
      await sendAndSave(ctx, faq.reply);
      if (next === "escalate") {
        // fall through on the same turn so we don't wait for another message
        stageId = next;
        stage = flow.stages[stageId];
      } else {
        return { stage: next };
      }
    }

    // --- 3. Gather structured fields ---
    if (stage.type === "collect") {
      const extracted = await step.run("extract", () => extractFields(ctx, stage));
      await step.run("persist-fields", () => mergeLeadFields(ctx, extracted.fields));

      const missing = missingRequired(ctx.lead.fields, stage.required_fields);
      if (missing.length > 0) {
        const question = await step.run("next-question", () =>
          draftQuestion(ctx, stage, missing),
        );
        await sendAndSave(ctx, question);
        return { stage: stageId, missing };
      }

      stageId = await persistStage(ctx, stage.on_complete);
      stage = flow.stages[stageId];
      // continue into action on the same turn (name+email just completed)
    }

    // --- 4. Actions once the graph says we are ready ---
    if (stage.type === "action") {
      const result = await step.run(`action:${stage.action}`, () =>
        runAction(ctx, stage.action),
      );
      const next = result.ok ? stage.on_complete : stage.on_fail;
      await persistStage(ctx, next);
      await sendAndSave(ctx, result.reply);
      return { stage: next, action: stage.action, ok: result.ok };
    }

    if (stage.type === "terminal") {
      return { stage: stageId };
    }

    return { stage: stageId };
  },
);
```

Helpers the interpreter calls (LLM stays inside steps; transitions stay in code):

```ts
async function classifyIntent(ctx: TurnContext, stage: Extract<Stage, { type: "classify" }>) {
  const { text } = await generateText({
    model,
    system: `${stage.prompt}\nReply with exactly one of: ${stage.intents.join(", ")}`,
    messages: toModelMessages(ctx.messages.slice(-8)),
  });
  const intent = stage.intents.find((i) => text.toLowerCase().includes(i));
  return intent ?? stage.intents[0];
}

async function extractFields(ctx: TurnContext, stage: Extract<Stage, { type: "collect" }>) {
  const keys = [...stage.required_fields, ...(stage.optional_fields ?? [])];
  const { toolCalls } = await generateText({
    model,
    system: `Extract any of these keys if the lead stated them: ${keys.join(", ")}. Do not invent.`,
    messages: toModelMessages(ctx.messages.slice(-12)),
    tools: {
      save: tool({
        inputSchema: z.object({
          fields: z.record(z.string(), z.string()),
        }),
        execute: async ({ fields }) => fields,
      }),
    },
  });
  return { fields: toolCalls[0]?.input?.fields ?? {} };
}

function missingRequired(fields: Record<string, unknown>, required: string[]) {
  return required.filter((k) => fields[k] == null || fields[k] === "");
}

async function runAction(ctx: TurnContext, action: "book_meeting" | "request_human") {
  if (action === "book_meeting") {
    const booked = await bookOnCalcom(ctx);
    return booked.ok
      ? { ok: true, reply: `Booked for ${booked.when}. See you then.` }
      : { ok: false, reply: booked.error };
  }
  await pauseForHuman(ctx, { type: "more_info", reason: "Support could not resolve" });
  return { ok: true, reply: "A person from the team will take this from here." };
}
```

Same-turn chaining (`collect` just filled → `schedule`) is intentional: the lead should not have to send “ok” to trigger Cal.com after the last field.

---



## Walkthrough

Lead: “Hi, I want a kitchen quote”

1. `flow_state` empty → `classify_intent`.
2. LLM step → `sales` → persist `collect_lead`.
3. Extract: no name/email/service yet. Ask: “What service — remodel or repair?”
4. (Next webhook, hours later) “Full remodel. I’m Dana, [dana@x.com](mailto:dana@x.com)”
5. Extract merges `{ service, name, email }`. `missing` is `[]`. Transition `schedule`.
6. `book_meeting` step. If Cal.com needs a slot, `on_fail` back to `collect_lead` and ask time preference.
7. `flow_state = done`. Further messages can no-op or restart per tenant policy.

Lead: “How do I reset the filter?”

1. Classify → `support` → `answer_support`.
2. FAQ hits knowledge → `done`, or miss → `escalate` → `request_human` → `waiting_human` (HITL, same as [agent-runtime.md](./agent-runtime.md)).

---



## Delayed nudge (`sleepUntil`) — separate function

Do **not** block the inbound turn for 24h. After sending a question, enqueue a reminder job:

```ts
export const nudgeIfSilent = inngest.createFunction(
  { id: "nudge-if-silent" },
  { event: "agent/nudge.requested" },
  async ({ event, step }) => {
    await step.sleepUntil("wait", event.data.nudgeAt); // now + 24h

    const convo = await loadConversation(event.data);
    if (convo.updatedAt > event.data.nudgeAt) return { skipped: "replied" };
    if (convo.flow_state !== event.data.expectedStage) return { skipped: "moved-on" };

    await sendOnChannel(convo, "Still happy to help — want to finish booking?");
  },
);
```

Fire `agent/nudge.requested` when you send a collect question. Cancel-by-condition on wake is enough; no Temporal.

---



## What the LLM is *not* allowed to do

- Pick the next stage (except classify, whose output is mapped by `transitions` in JSON).
- Call `book_meeting` while `missing.length > 0` — the interpreter never enters `action` until then.
- Use another tenant’s flow — `agent.flow` is loaded with `tenantId`.

The LLM: classify, extract, FAQ wording, next question. The JSON + Inngest function: rails.

---



## vs LangGraph (same shape, different runtime)


|                   | LangGraph                                    | This                                           |
| ----------------- | -------------------------------------------- | ---------------------------------------------- |
| Graph             | Compiled `StateGraph` in code (or LangSmith) | JSON on `agents.flow`                          |
| Current node      | Checkpointer thread                          | `conversations.flow_state`                     |
| Node body         | Python/TS node functions                     | `stage.type` switch in **one** Inngest fn      |
| Durable retry     | Graph + checkpointer                         | Inngest `step.run`                             |
| Multi-tenant      | You still build it                           | One interpreter, different JSON rows           |
| HITL              | `interrupt()` in the graph                   | `request_human` action → CRM + `waiting_human` |
| Next user message | Resume thread                                | New event; load state again                    |


We copy the **data model** of a graph (nodes and edges). We do not copy the **framework**.

---



## vs “prompt only” and vs n8n

- **Prompt + tools alone** — fine for a demo; not the v1 control plane. Flow JSON is.
- **n8n as the messenger** — still not. Optional `action` type later (`n8n_webhook`) for side effects after `done`. Do not put “ask name” in n8n.

---



## Ops workflow

1. Pick or clone a JSON template (`salesOrSupportFlow` vs two-stage collect).
2. Edit `required_fields` / copy / transitions in DB or a simple internal form (not a visual LangGraph editor).
3. Bind WhatsApp/IG channel to that agent.
4. No deploy unless you add a new `stage.type` to the interpreter (`classify` | `collect` | `faq` | `action` | `terminal` covers v1).

