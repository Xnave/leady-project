import { copyFor } from "@/lib/copy";
import { missingRequired } from "./helpers";
import type { LeadFields } from "./types";

export function bookingFieldGaps(
  fields: LeadFields,
  required: string[] = ["time_preference", "name", "need"],
): string[] {
  const contactKeys = new Set(["phone", "email"]);
  const missing = missingRequired(
    fields,
    required.filter((key) => !contactKeys.has(key)),
  );
  if (required.includes("phone") && !String(fields.phone ?? "").trim()) {
    missing.push("phone");
  }
  if (required.includes("email") && !String(fields.email ?? "").trim()) {
    missing.push("email");
  }
  return missing;
}

const FIELD_LABELS: Record<"en" | "he", Record<string, string>> = {
  en: {
    time_preference: "a day and time",
    name: "a name",
    need: "what the visit is for",
    phone: "a phone number",
    email: "an email",
    visit_kind: "the visit type",
  },
  he: {
    time_preference: "יום ושעה",
    name: "שם",
    need: "את מטרת הפגישה",
    phone: "מספר טלפון",
    email: "אימייל",
    visit_kind: "סוג ביקור",
  },
};

export function bookingFieldLabel(lang: "en" | "he", field: string): string {
  return FIELD_LABELS[lang][field] ?? field.replaceAll("_", " ");
}

export function askBookingField(
  lang: "en" | "he",
  field: string,
  extras?: { hours?: string; deducedPhone?: string },
): string {
  const hours = extras?.hours?.trim() ?? "";
  const chat = copyFor(lang).chat;
  if (field === "name") return chat.askName;
  if (field === "email") return chat.askEmail;
  if (field === "phone") {
    const deduced = extras?.deducedPhone?.trim();
    return deduced ? chat.askPhoneConfirm(deduced) : chat.askPhone;
  }
  if (field === "need") return chat.askNeed;
  if (field === "visit_kind") return chat.askVisitKind;
  if (field === "time_preference") return chat.askTime(hours);
  return chat.askFieldFallback(bookingFieldLabel(lang, field));
}

function lastAskMatches(lastAgent: string, ask: string): boolean {
  const last = lastAgent.trim();
  if (!last || !ask) return false;
  return last === ask || last.endsWith(ask) || last.includes(ask);
}

function looksLikeTimeAsk(reply: string, lang: "en" | "he", hours: string): boolean {
  const ask = askBookingField(lang, "time_preference", { hours });
  if (reply.includes(ask)) return true;
  return /מתי|שעה|יום ושעה|what day|when works|day and time|what time/i.test(reply);
}

export function finalizeTalkReply(opts: {
  reply: string;
  book?: boolean;
  lang: "en" | "he";
  hours: string;
  gaps: string[];
  lastAgentText: string;
  deducedPhone?: string;
}): { reply: string; book: boolean } {
  let reply = opts.reply.trim();
  let book = Boolean(opts.book);
  const chat = copyFor(opts.lang).chat;
  const lastAgent = opts.lastAgentText.trim();

  if (book && opts.gaps.length > 0) {
    book = false;
    const field = opts.gaps[0];
    let ask = askBookingField(opts.lang, field, {
      hours: opts.hours,
      deducedPhone: opts.deducedPhone,
    });
    if (lastAskMatches(lastAgent, ask)) {
      ask =
        field === "phone"
          ? opts.deducedPhone?.trim()
            ? chat.askPhoneConfirm(opts.deducedPhone.trim())
            : chat.askPhoneAgain
          : chat.askFieldAgain(bookingFieldLabel(opts.lang, field));
      if (lastAskMatches(lastAgent, ask)) {
        return { reply: ask, book: false };
      }
    }
    // Collect turns: send only the ask — no "I noted the visit…" chatter.
    return { reply: ask, book: false };
  }

  if (
    !book &&
    opts.hours &&
    opts.gaps[0] === "time_preference" &&
    looksLikeTimeAsk(reply, opts.lang, opts.hours) &&
    !reply.includes(opts.hours) &&
    !lastAgent.includes(opts.hours)
  ) {
    reply = `${reply}\n${chat.hoursLine(opts.hours)}`;
  }

  return { reply, book };
}

export function inferTalkIntent(
  lastCustomer: string,
  need?: string,
): "sales" | "support" | "other" | undefined {
  const hay = `${lastCustomer} ${need ?? ""}`.toLowerCase();
  const support =
    /warranty|complaint|no-?show|never showed|installer|broken|refund|manager|אחריות|תלונה|לא הגיע|תקלה|נציג/.test(
      hay,
    );
  const sales = /quote|book|measur|visit|kitchen|הצעת|פגישה|מדיד|מטבח/.test(hay);
  if (support) return "support";
  if (sales) return "sales";
  return undefined;
}

const YES_RE =
  /^(yes|yeah|yep|sure|ok|okay|confirm|confirmed|כן|בטח|מאשר|מאשרת|סבבה|בסדר|תשתמשו|תשתמש|זה בסדר)([!.\s]|$)/i;

export function looksLikePhoneConfirm(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (YES_RE.test(t)) return true;
  return /^(yes|כן).{0,40}(phone|מספר|טלפון|זה|number)/i.test(t);
}
