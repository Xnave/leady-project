export type ScenarioCapability = "booking" | "reservations";

export type ScenarioTarget = "local" | "canary" | "live";

/** State checked after a phase. Language and repeated replies are always checked. */
export type ScenarioPhaseExpect = {
  request?: "none" | "pending" | "approved" | "rejected";
  /** Weekday of the stay's check-in, taken from the request time text. */
  requestStartsOn?: "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
  /** Fail when a request of this capability has this status. */
  requestNot?: "approved" | "pending";
  /** Open `request_approval` task. */
  hitlOpen?: boolean;
  /** waiting_human, or an open handoff task. */
  handoff?: boolean;
  conversationStatus?: string;
  crmPresent?: string[];
  /** Present on the latest session or on lead fields. */
  sessionPresent?: string[];
  /** Absent from both the latest session and lead fields. */
  sessionAbsent?: string[];
  /**
   * Substrings that must not appear in the last agent reply of the current thread.
   * Catches a plausible hours question that ignores a time the customer already gave.
   */
  replyAvoids?: string[];
  /** Substrings that must appear in the last agent reply of the current thread. */
  replyIncludes?: string[];
  /**
   * The customer line must come after an agent message that asked for it.
   * `anyOf` matches if one phrase appears in an earlier agent reply.
   */
  agentAskedBefore?: { customerIncludes: string; anyOf: string[] }[];
  sessionEmpty?: boolean;
  /** Latest conversation id differs from the one before this phase. */
  freshConversation?: boolean;
};

export type ScenarioVariant = {
  id: string;
  primary?: boolean;
  /** Eligible for `--sample`. Not run with the default suite. */
  sample?: boolean;
  turns: string[];
  review?: string;
  expect?: ScenarioPhaseExpect;
};

export type Scenario = {
  id: string;
  suite: "smoke" | "full" | "link" | "extra";
  capability: ScenarioCapability;
  /**
   * Days a passing run can wait before `--due` selects it again.
   * Omitted scenarios are due on every run of their suite.
   */
  cadenceDays?: number;
  /** `link` uses SCENARIO_RESERVATION_LINK_TENANT_ID. Omitted uses the hold tenant. */
  pool?: "link";
  review: string;
  expect: ScenarioPhaseExpect;
  decide?: {
    decision: "approve" | "decline" | "reschedule";
    /** Offered start. A stay also sets alternativeEnd. A visit uses this as the slot text. */
    alternativeStart?: string;
    alternativeEnd?: string;
    then?: ScenarioPhaseExpect;
  };
  followUp?: {
    turns: string[];
    expect?: ScenarioPhaseExpect;
    review?: string;
  };
  /** Close the thread and force the next inbound into a new conversation. */
  endThen?: {
    turns: string[];
    expect?: ScenarioPhaseExpect;
    review?: string;
  };
  variants: ScenarioVariant[];
};

export type ScenarioMessage = {
  conversationId: string;
  role: string;
  text: string;
};

export type ScenarioSnapshot = {
  tenantId: string;
  tenantName: string;
  personaGender: "female" | "male" | "";
  chatLanguage: string;
  leadId: string;
  externalUserId: string;
  conversationId: string;
  status: string;
  flowState: string;
  lifecycleReason: string;
  crm: Record<string, unknown>;
  session: Record<string, unknown>;
  messages: ScenarioMessage[];
  requests: { id: string; capabilityId: string; status: string; timeText: string }[];
  hitl: { id: string; type: string; status: string; reason: string }[];
};

export type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};
