import type { ChatLanguage } from "./locale";

export type LeadFieldType = "string" | "email" | "enum";

export type LeadSchema = {
  fields: Record<
    string,
    { type: LeadFieldType; requiredGlobal?: boolean; enum?: string[] }
  >;
};

export type NudgeSpec = {
  after: string;
  template: string;
  maxTimes?: number;
};

export type RestartPolicy = {
  onNewMessage: "ignore" | "restart" | "fallback";
  fallbackStage?: string;
};

export type HitlPolicy = {
  allowRequestHuman: boolean;
  allowedFromStages: string[];
  allowedIntents?: string[];
  allowedDocumentTypes?: string[];
  minConfidence?: number;
};

type StageBase = {
  nudge?: NudgeSpec;
};

export type ClassifyStage = StageBase & {
  type: "classify";
  prompt: string;
  intents: string[];
  transitions: Record<string, string>;
};

export type CollectStage = StageBase & {
  type: "collect";
  prompt: string;
  required_fields: string[];
  optional_fields?: string[];
  ask_one_at_a_time?: boolean;
  on_complete: string;
};

export type FaqStage = StageBase & {
  type: "faq";
  prompt: string;
  on_resolved: string;
  on_unresolved: string;
};

export type ActionStage = StageBase & {
  type: "action";
  action: "book_meeting" | "request_human";
  on_complete: string;
  on_fail: string;
};

export type TerminalStage = StageBase & { type: "terminal" };

export type TalkStage = StageBase & {
  type: "talk";
  prompt: string;
  allowBook?: boolean;
  required_for_book?: string[];
  on_complete: string;
  on_escalate: string;
};

export type Stage =
  | ClassifyStage
  | CollectStage
  | FaqStage
  | ActionStage
  | TalkStage
  | TerminalStage;

export type FlowDefinition = {
  start: string;
  restartPolicy: RestartPolicy;
  stages: Record<string, Stage>;
};

export type LeadFields = Record<string, unknown>;

export type ConversationSnapshot = {
  id: string;
  status: "open" | "waiting_human" | "closed";
  flowState: string;
  flowVersion: number;
  nudgeCountByStage: Record<string, number>;
};

export type AgentSnapshot = {
  id: string;
  tenantId: string;
  catalogId?: string;
  systemPrompt: string;
  knowledgeText: string;
  flow: FlowDefinition;
  flowVersion: number;
  leadSchema: LeadSchema;
  hitlPolicy: HitlPolicy;
  calcomEventTypeId?: string | null;
};

export type TenantSnapshot = {
  name: string;
  phone: string;
  intro: string;
  chatLanguage: ChatLanguage;
  idleResetDays?: number;
  venueAddress?: string;
  venueHours?: string;
  bookingRequestTemplate?: string;
  bookingApprovedTemplate?: string;
  bookingRejectedTemplate?: string;
};

export type MessageSnapshot = {
  role: "lead" | "agent" | "human" | "system";
  text: string;
  createdAt?: Date | string;
};

export type TalkOutcome = {
  reply: string;
  fields?: LeadFields;
  intent?: string;
  book?: boolean;
  escalate?: boolean;
  escalateReason?: string;
  complete?: boolean;
};

export type ChannelSnapshot = {
  provider: string;
  customerPhone?: string;
};

export type TurnContext = {
  tenantId: string;
  tenant?: TenantSnapshot;
  agent: AgentSnapshot;
  conversation: ConversationSnapshot;
  lead: { id: string; externalUserId: string; fields: LeadFields };
  messages: MessageSnapshot[];
  channel?: ChannelSnapshot;
};

export class FlowConfigError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join("; "));
    this.name = "FlowConfigError";
  }
}
