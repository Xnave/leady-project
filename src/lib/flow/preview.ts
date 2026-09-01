import { interpretTurn } from "./interpreter";
import { heuristicPreviewClassify, previewExtract } from "./preview-helpers";
import { heuristicTalk } from "./llm";
import type { AgentSnapshot, LeadFields, TenantSnapshot, TurnContext } from "./types";
import { validateFlow } from "./validate";

export type PreviewResult = {
  path: string[];
  replies: string[];
  fields: LeadFields;
  actions: string[];
  errors: string[];
};

export async function previewFlow(
  agent: Pick<
    AgentSnapshot,
    "flow" | "leadSchema" | "hitlPolicy" | "knowledgeText" | "systemPrompt"
  > & { tenant?: TenantSnapshot },
  transcript: string[],
): Promise<PreviewResult> {
  const errors: string[] = [];
  try {
    validateFlow(agent.flow, agent.leadSchema, agent.hitlPolicy);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "invalid flow");
    return { path: [], replies: [], fields: {}, actions: [], errors };
  }

  const ctx: TurnContext = {
    tenantId: "preview",
    tenant: agent.tenant,
    agent: {
      id: "preview",
      tenantId: "preview",
      systemPrompt: agent.systemPrompt,
      knowledgeText: agent.knowledgeText,
      flow: agent.flow,
      flowVersion: 1,
      leadSchema: agent.leadSchema,
      hitlPolicy: agent.hitlPolicy,
    },
    conversation: {
      id: "preview",
      status: "open",
      flowState: agent.flow.start,
      flowVersion: 1,
      nudgeCountByStage: {},
    },
    lead: { id: "preview", externalUserId: "preview-user", fields: {} },
    messages: [],
  };

  const path: string[] = [ctx.conversation.flowState];
  const replies: string[] = [];
  const actions: string[] = [];

  for (const line of transcript) {
    ctx.messages.push({ role: "lead", text: line });
    await interpretTurn(ctx, {}, {
      classify: async (_c, stage) => heuristicPreviewClassify(line, stage.intents),
      extract: async () => previewExtract(line),
      draftQuestion: async (_c, _s, missing) => `Need ${missing[0]}`,
      answerFaq: async () => {
        const resolved = Boolean(agent.knowledgeText) && !/cannot|unknown/i.test(line);
        return {
          resolved,
          reply: resolved ? agent.knowledgeText.slice(0, 200) : "escalate",
        };
      },
      talk: async (c, stage) => heuristicTalk(c, stage),
      bookMeeting: async (c) => {
        actions.push("book_meeting");
        if (!c.lead.fields.email) return { ok: false, reply: "missing email" };
        return { ok: true, reply: "booked" };
      },
      requestHuman: async () => {
        actions.push("request_human");
        ctx.conversation.status = "waiting_human";
      },
      persistStage: async (_c, id) => {
        ctx.conversation.flowState = id;
        path.push(id);
      },
      persistFields: async (_c, fields) => {
        ctx.lead.fields = fields;
      },
      sendAndSave: async (_c, text) => {
        replies.push(text);
        ctx.messages.push({ role: "agent", text });
      },
      scheduleNudge: async () => undefined,
      log: () => undefined,
    });
  }

  return { path, replies, fields: ctx.lead.fields, actions, errors };
}
