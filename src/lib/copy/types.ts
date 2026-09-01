export type BookingVars = {
  slot: string;
  address: string;
  hours: string;
  name: string;
  phone: string;
  email: string;
  need: string;
  kind: string;
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
  askNeed: string;
  askVisitKind: string;
  askTime: (hours: string) => string;
  askFieldFallback: (field: string) => string;
  availability: (hours: string) => string;
  hoursLine: (hours: string) => string;
  bookingRequestTemplate: string;
  bookingApprovedTemplate: string;
  bookingRejected: string;
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
};
