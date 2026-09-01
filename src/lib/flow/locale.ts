import type { LeadFields } from "./types";
import { askedWhenForVisit, looksLikeTimePreference } from "./booking";

export type ChatLanguage = "multi" | "en" | "he";

export const chatLanguageMeta: { id: ChatLanguage; title: string; blurb: string }[] = [
  {
    id: "multi",
    title: "לפי הלקוח · Match customer",
    blurb: "עונה בעברית או באנגלית לפי מה שכתבו.",
  },
  {
    id: "he",
    title: "עברית בלבד · Hebrew only",
    blurb: "הסוכן תמיד עונה בעברית.",
  },
  {
    id: "en",
    title: "English only · אנגלית בלבד",
    blurb: "Always reply in English.",
  },
];

export function isChatLanguage(value: string): value is ChatLanguage {
  return value === "multi" || value === "en" || value === "he";
}

export function looksHebrew(text: string): boolean {
  return /\p{Script=Hebrew}/u.test(text);
}

const GREETING_EN = /^(hi|hello|hey|yo)\b/i;
const GREETING_HE = /^(שלום|היי|הי|אהלן|בוקר טוב|ערב טוב|מה נשמע|מה קורה)/;

export function isGreetingOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const stripped = t
    .replace(/[.!?…,]/g, " ")
    .replace(/\b(hi|hello|hey)\b/gi, " ")
    .replace(/שלום|היי|הי|אהלן|ברוך הבא|מה נשמע|מה קורה|מה שלומך/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length === 0;
}

export function heuristicIntent(text: string): "sales" | "support" | "other" {
  const blob = text.toLowerCase();
  if (
    /\b(how|reset|broken|help|filter|warranty|support)\b/.test(blob) ||
    /תקול|שבור|לא עובד|אחריות|תמיכה|מסנן/.test(text)
  ) {
    return "support";
  }
  if (
    /\b(quote|book|visit|price|remodel|buy|install|kitchen)\b/.test(blob) ||
    /מטבח|להתאים|הצעת מחיר|לתאם|ביקור|שיפוץ|התקנה|מחיר|דירה חדשה/.test(text)
  ) {
    return "sales";
  }
  return "other";
}

export function leadTranscript(messages: { role: string; text: string }[]): string {
  return messages
    .filter((m) => m.role === "lead")
    .map((m) => m.text)
    .join("\n");
}

export function lastAgentText(messages: { role: string; text: string }[]): string {
  return [...messages].reverse().find((m) => m.role === "agent")?.text ?? "";
}

export function lastLeadMessage(
  messages: { role: string; text: string }[],
): string {
  return [...messages].reverse().find((m) => m.role === "lead")?.text ?? "";
}

/** They asked to schedule, or said yes after the agent offered a visit. */
export function customerReadyToBook(
  messages: { role: string; text: string }[],
): boolean {
  if (customerAskedToSchedule(messages)) return true;
  const agent = lastAgentText(messages);
  const lead = lastLeadMessage(messages).trim();
  const offered =
    /מדידה|ביקור|אולם|פגישה|מתי|סניף|visit|measure|showroom|book a|schedule/i.test(
      agent,
    );
  const yes = /^(כן|יאללה|בשמחה|קבעו|בואו|אוקיי|ok|okay|yes|sure)[.!?]*$/i.test(
    lead,
  );
  if (offered && yes) return true;
  if (askedWhenForVisit(agent) && looksLikeTimePreference(lead)) return true;
  return false;
}

export function askedNewVsRemodel(agentText: string): boolean {
  return /חדש או שיפוץ|new kitchen or a remodel/i.test(agentText);
}

/** Persist as leadSchema.service: remodel | repair | other (new install). */
export function extractKitchenService(text: string, lastAgent: string): LeadFields {
  const t = text.trim();
  if (/שיפוץ|remodel/i.test(t)) return { service: "remodel" };
  if (/תיקון|\brepair\b/i.test(t)) return { service: "repair" };
  const newHint =
    /דירה חדשה|מטבח חדש|מטבח ריק|brand new|\bnew kitchen\b/i.test(t) ||
    /^(חדש|new)[.!?]*$/i.test(t) ||
    (askedNewVsRemodel(lastAgent) && /חדש|^new\b/i.test(t));
  if (newHint) return { service: "other" };
  return {};
}

export function inferKitchenKind(
  messages: { role: string; text: string }[],
  fields: LeadFields,
): "new" | "remodel" | "repair" | null {
  if (fields.service === "remodel") return "remodel";
  if (fields.service === "repair") return "repair";
  if (fields.service === "other") return "new";
  const blob = leadTranscript(messages);
  if (/שיפוץ|remodel/i.test(blob)) return "remodel";
  if (/תיקון|\brepair\b/i.test(blob)) return "repair";
  if (/חדש|דירה חדשה|מטבח ריק|brand new|new kitchen/i.test(blob)) return "new";
  return null;
}

export function hasStyleDetails(text: string): boolean {
  return (
    text.trim().length > 50 ||
    /מודרני|מינימל|אחסון|סטייל|modern|minimal|storage|style/i.test(text)
  );
}

export function conversationIntent(
  messages: { role: string; text: string }[],
  lastText: string,
): "sales" | "support" | "other" {
  const latest = heuristicIntent(lastText);
  if (latest !== "other") return latest;
  if (askedNewVsRemodel(lastAgentText(messages))) return "sales";
  for (const m of messages) {
    if (m.role === "lead" && heuristicIntent(m.text) === "sales") return "sales";
    if (m.role === "lead" && heuristicIntent(m.text) === "support") return "support";
  }
  return "other";
}

export function askedStyleQuestion(agentText: string): boolean {
  return /סגנון בראש|style in mind|נבחר יחד במדידה|decide when we measure/i.test(agentText);
}

export function deferredStyleChoice(text: string): boolean {
  return /נבחר יחד|together|במדידה|when we measure|תבחרו אתם|אין לי סגנון/i.test(text);
}

export function nextSalesReply(
  lang: "en" | "he",
  opts: {
    kind: "new" | "remodel" | "repair" | null;
    lastCustomer: string;
    lastAgent: string;
  },
): string {
  const { kind, lastCustomer, lastAgent } = opts;
  const wouldAskKind =
    lang === "he"
      ? "מעולה — נשמח להתאים מטבח. זה מטבח חדש או שיפוץ?"
      : "Great — we can help with that. Is this a new kitchen or a remodel?";
  const wouldAskStyle =
    lang === "he"
      ? "מעולה, מטבח חדש. יש כבר סגנון בראש (מודרני, כפרי…), או שנבחר יחד במדידה?"
      : "A new kitchen — nice. Any style in mind, or shall we decide when we measure?";
  const wouldAskMeasure =
    lang === "he"
      ? "מעולה, נבחר סגנון במדידה. מתי נוח שמישהו יגיע לדירה?"
      : "Great — we'll pick the look on site. When is a good time for a visit?";

  const sameAsLast = (text: string) =>
    lastAgent.trim().length > 0 && text.trim() === lastAgent.trim();

  if (/תכנון תלת|תלת[-\s]?מימד|שלב התכנון|3\s*d plan/i.test(lastAgent)) {
    return lang === "he"
      ? "תכנון תלת-ממדי נעשה בפגישה עם הצוות, לא בצ'אט. אפשר לקבוע מדידה או ביקור באולם? מתי נוח?"
      : "3D planning is done in a meeting with the team, not in chat. Want to book a measurement or showroom visit?";
  }

  if (hasStyleDetails(lastCustomer)) {
    return lang === "he"
      ? "תודה, רשמתי. אני לא מעצב ולא בונה תכנון תלת-ממדי בצ'אט — זה בפגישה עם הצוות. אפשר לקבוע מדידה או ביקור באולם? מתי נוח?"
      : "Thanks, I've noted that. I don't design or do 3D plans in chat — the team does that in a meeting. Want to book a measurement or showroom visit?";
  }

  if (deferredStyleChoice(lastCustomer) || askedStyleQuestion(lastAgent)) {
    if (!sameAsLast(wouldAskMeasure)) return wouldAskMeasure;
  }

  if (!kind && !askedNewVsRemodel(lastAgent)) {
    return wouldAskKind;
  }

  if (kind) {
    if (sameAsLast(wouldAskStyle) || askedStyleQuestion(lastAgent)) return wouldAskMeasure;
    return wouldAskStyle;
  }

  return lang === "he" ? "ספר לי עוד על החלל והסגנון שאתה רוצה." : "Tell me a bit more about the space and the look you want.";
}

export function resolveReplyLanguage(
  policy: ChatLanguage | undefined,
  lastCustomerText: string,
): "en" | "he" {
  if (policy === "he") return "he";
  if (policy === "en") return "en";
  return looksHebrew(lastCustomerText) ? "he" : "en";
}

export function languageSystemRule(policy: ChatLanguage | undefined): string {
  if (policy === "he") {
    return "Reply only in Hebrew. Never mix in English filler like Hi / How can I help if the intro is already Hebrew.";
  }
  if (policy === "en") {
    return "Reply only in English.";
  }
  return "Reply in the same language as the customer's latest message. If they write Hebrew, the entire reply must be Hebrew — do not wrap a Hebrew intro in an English greeting.";
}

export function englishGreetingPattern(): RegExp {
  return GREETING_EN;
}

export function hebrewGreetingPattern(): RegExp {
  return GREETING_HE;
}

/** True only if they asked to schedule a visit/slot — not merely gave a name or email. */
export function customerAskedToSchedule(
  messages: { role: string; text: string }[],
): boolean {
  const blob = messages
    .filter((m) => m.role === "lead")
    .map((m) => m.text)
    .join("\n");
  if (
    /\b(book|booking|schedule|appointment|calendar|timeslot|time slot|come in|come over|showroom)\b/i.test(
      blob,
    )
  ) {
    return true;
  }
  if (/\b(site visit|measure (?:the )?(?:space|kitchen))\b/i.test(blob)) {
    return true;
  }
  return /לתאם(?:\s|$)|מדידה|פגישה|תור\b|יומן|תגיעו|מתי נוח|לבוא|אשמח לבוא|אגיע|סניף|אולם/.test(
    blob,
  );
}

export function bookingConfirmation(
  lang: "en" | "he",
  _email: string,
  when: string,
): string {
  if (lang === "he") {
    return `ההזמנה נקלטה במערכת למועד: ${when}. נחזור אליך אחרי אישור הצוות.`;
  }
  return `Request received for ${when}. The team will confirm shortly.`;
}
