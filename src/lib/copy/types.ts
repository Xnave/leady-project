export type BookingVars = {
  slot: string;
  date: string;
  time: string;
  /** Weekday name for approval copy (e.g. חמישי / Thursday). */
  weekday: string;
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
  /** First line of a conversation: who the agent is and that it's the business's digital/AI assistant. */
  assistantIntro: (o: { agentName: string; business: string; gender: "female" | "male" }) => string;
  askHowToHelp: string;
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
  /** Present gathered context and invite optional extras in one message. */
  askNeedWithGathered: (gathered: string) => string;
  /** Lead-in before the deterministic booking confirm fact block. */
  bookingConfirmIntro: string;
  /** Closing ask after the booking confirm fact block. */
  bookingConfirmAsk: string;
  /** Customer said no to saving the visit. Ask whether to change the time or stop. */
  bookingDeclineAsk: string;
  askVisitKind: string;
  askTime: (hours: string) => string;
  /** When a proposed time is outside venue hours. */
  askTimeOutsideHours: (hours: string) => string;
  /** Bare hour without morning/evening - ask which they meant. */
  askTimeAmbiguous: string;
  /** Day/time wording had no clear clock. */
  askTimeUnclear: string;
  /** Venue hours are configured but unusable for the gate. */
  askTimeInvalidHours: string;
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
  /** Span-request mechanics (dates, availability, approvals) - nouns come from config. */
  request: RequestChatCopy;
  documents: {
    askId: string;
    notFound: string;
    notConfigured: string;
    askStage: (docs: string) => string;
    askIdCard: string;
    askPayslips: string;
    /** Attach a borrower to a document name: "ID card for Dana". */
    ownedBy: (label: string, who: string) => string;
    /** Attach a borrower to a full sentence that already asks for a file. */
    forBorrower: (line: string, who: string) => string;
    borrowerRole: Record<"salaried" | "self_employed" | "controlling_shareholder" | "both", string>;
    borrowerOrder: Record<"1" | "2", string>;
    askEmployment: (name: string) => string;
    askSecondBorrower: string;
    askCouple: string;
    askIdBiometric: (name: string) => string;
    askIdBack: string;
    askFirstHome: string;
    askLoans: string;
    askMoreLoans: string;
    askAccounts: string;
    askSalaryDeposit: (name: string) => string;
    askMorePhotos: string;
    howTo: (docType: string) => string;
    howToDetail: (docType: string) => string;
    revised: (kind: string, detail?: string) => string;
    retracted: string;
    notIdBack: string;
    idBackTryAgain: string;
    confirmChange: (kind: string, detail?: string) => string;
    confirmTurn: (changes: string[]) => string;
    noLoans: string;
    blankForm: (doc: string) => string;
    nextStage: string;
    advisorFlag: (label: string) => string;
    received: (doc: string) => string;
    rejected: (doc: string, reason: string, detail?: string) => string;
    complete: string;
    /** What the customer receives when an advisor sends files back. */
    returnFiles: (items: { label: string; note: string }[]) => string;
    askEscalate: string;
    cooldownWait: (minutes: number) => string;
    escalateAccepted: string;
    escalateDeclined: string;
    /** Kept for older dossiers that were already handed off. */
    escalated: string;
    uploadFailed: string;
    reasons: Record<string, string>;
  };
};

/**
 * Sentence mechanics for a date-span request. Every place the business's own
 * word would appear takes a `noun` argument, which the capability reads from its
 * `CapabilityInstance` config - so a villa says "stay" and a dress shop says
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
  sendBookingLink: (noun: string, url: string) => string;
  offerAltDates: (from: string, to: string) => string;
  offerDeclineAsk: string;
  offerReplacement: (from: string, to: string) => string;
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
    /** Missing stance is passive: suggest a meeting only when it fits, not on every reply. */
    bookingStance?: "passive" | "proactive";
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
