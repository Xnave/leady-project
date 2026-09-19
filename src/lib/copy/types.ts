export type BookingVars = {
  slot: string;
  date: string;
  time: string;
  address: string;
  hours: string;
  name: string;
  phone: string;
  email: string;
  need: string;
  kind: string;
  details: string;
  /** Tenant / business display name for customer-facing booking acks. */
  business: string;
};

export type ChatCopy = {
  fallbackTeamName: string;
  hello: (name: string) => string;
  helloHelp: (name: string) => string;
  howCanIHelp: string;
  howCanIHelpRe: RegExp;
  greetWithIntro: (name: string, intro: string, askHelp: boolean) => string;
  tellMeMore: string;
  supportAsk: string;
  savingVisit: string;
  faqUnresolved: string;
  faqNoKnowledge: string;
  whyCollect: string;
  askName: string;
  askEmail: string;
  askPhone: string;
  askPhoneConfirm: (phone: string) => string;
  askPhoneAgain: string;
  askFieldAgain: (field: string) => string;
  waitingHumanHold: string;
  askNeed: string;
  askVisitKind: string;
  askTime: (hours: string) => string;
  /** When a proposed time is outside venue hours. */
  askTimeOutsideHours: (hours: string) => string;
  askFieldFallback: (field: string) => string;
  /** Generic ask for a field that has a fixed set of choices. */
  askFieldWithOptions: (field: string, options: string) => string;
  availability: (hours: string) => string;
  hoursLine: (hours: string) => string;
  bookingRequestTemplate: string;
  bookingApprovedTemplate: string;
  /** Decline without offering another slot */
  bookingRejected: string;
  /** Decline + offer an alternative slot ({{alt_slot}}) */
  bookingReschedule: string;
  notePrefix: string;
  /** Span-request mechanics (dates, availability, approvals) — nouns come from config. */
  request: RequestChatCopy;
};

/**
 * Sentence mechanics for a date-span request. Every place the business's own
 * word would appear takes a `noun` argument, which the capability reads from its
 * `CapabilityInstance` config — so a villa says "stay" and a dress shop says
 * "rental" with no copy change.
 */
export type RequestChatCopy = {
  askField: (label: string) => string;
  confirmTitle: (noun: string) => string;
  confirmAsk: string;
  needValidDates: string;
  invalidDates: string;
  stillNeed: (gaps: string) => string;
  availabilityNotConfigured: string;
  datesUnavailable: (url: string) => string;
  datesAvailable: string;
  availabilityUnknownLink: (url: string) => string;
  availabilityUnknownHitl: string;
  defaultRequest: (opts: {
    noun: string;
    from: string;
    to: string;
    /** Already-formatted extras, e.g. "4 guests · Garden suite". */
    details: string;
  }) => string;
  defaultApproved: (noun: string, from: string, to: string) => string;
  defaultRejected: (noun: string, from: string, to: string, note: string) => string;
  completeBookingLink: (url: string) => string;
  offerAltDates: (from: string, to: string) => string;
  offerDeclineAsk: string;
  offerUnclearAsk: string;
};

export type PromptCopy = {
  languageRule: string;
  languageRuleMatch: string;
  systemRole: (name: string, intro: string, phone: string) => string;
  catalogInbox: (fields: string) => string;
  catalogBook: (fields: string) => string;
  catalogFaq: string;
  talkGuardrails: (opts: {
    allowBook: boolean;
    fields: string;
    hours: string;
    whatsappPhone: string;
  }) => string;
  extractFields: (nextField: string) => string;
  draftQuestion: (nextField: string) => string;
  faqSystem: (prompt: string, knowledge: string) => string;
  extractOnboard: string;
  talkContext: (opts: {
    business: string;
    intro: string;
    knowledge: string;
    fieldsJson: string;
    channelLine: string;
    requiredFields: string;
    hours: string;
    address: string;
    last: string;
  }) => string;
  /** Operator / flow hint for silence follow-ups (not the literal outbound text). */
  nudgeDefaultInstruction: string;
  nudgeTurn: (instruction: string) => string;
};
