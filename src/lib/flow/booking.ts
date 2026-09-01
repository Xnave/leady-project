import { missingRequired } from "./helpers";
import type { LeadFields } from "./types";

export function looksLikeTimePreference(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 80) return false;
  const day =
    /ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|sunday|monday|tuesday|wednesday|thursday|friday|saturday/i.test(
      t,
    );
  const clock =
    /\d{1,2}([:.]?\d{2})?|בבוקר|בערב|צהר|אחר.?צ|afternoon|morning|evening|am\b|pm\b/i.test(
      t,
    );
  return day || (clock && t.length < 40);
}

export function extractTimePreference(text: string): string | undefined {
  const t = text.trim().replace(/אחרצ/g, "אחר הצהריים");
  if (!looksLikeTimePreference(t)) return undefined;
  const hour = t.match(/\b(?:ב)?(\d{1,2})(?::(\d{2}))?\b/);
  const afternoon = /אחר.?צהר|evening|pm\b|אחר הצהריים/i.test(t);
  if (hour && afternoon) {
    const h = Number(hour[1]);
    if (h > 0 && h < 12) {
      const mm = hour[2] ?? "00";
      return t.replace(hour[0], `${h + 12}:${mm}`).replace(/^ב/, "");
    }
  }
  return t.replace(/^ב/, "");
}

export function extractVisitKind(text: string): "showroom" | "home" | undefined {
  if (/בבית|אצלי|מדידה|come (?:to )?(?:my|the) (?:home|house)|site visit/i.test(text)) {
    if (/סניף|אולם|אליכם|לבוא אליכם|showroom/i.test(text)) return "showroom";
    if (/בבית|אצלי|מדידה/i.test(text)) return "home";
  }
  if (/לבוא|סניף|אולם|אליכם|showroom|come (?:in|over|to you)/i.test(text)) {
    return "showroom";
  }
  return undefined;
}

export function askedWhenForVisit(agentText: string): boolean {
  return /מתי|when (?:would|is|works|can)|what time|שעות פתיחה/i.test(agentText);
}

export function bookingFieldGaps(
  fields: LeadFields,
  required: string[] = ["time_preference", "name"],
): string[] {
  const missing = missingRequired(fields, required);
  if (!String(fields.email ?? "").trim() && !String(fields.phone ?? "").trim()) {
    missing.push("phone");
  }
  return missing;
}

export function askBookingField(lang: "en" | "he", field: string): string {
  if (lang === "he") {
    if (field === "name") return "כדי לקלוט את ההזמנה במערכת — איך קוראים לך?";
    if (field === "email") return "מה האימייל שלך לאישור הפגישה?";
    if (field === "phone") return "מה מספר הטלפון שלך לאישור הפגישה?";
    if (field === "time_preference") return "מתי נוח לך? יום ושעה.";
    return `חסר לי עוד פרט לפגישה: ${field}.`;
  }
  if (field === "name") return "To put this in the system — what's your name?";
  if (field === "email") return "What email should we use for the visit?";
  if (field === "phone") return "What phone number should we use for the visit?";
  if (field === "time_preference") return "When works for you? Day and time.";
  return `I still need ${field.replaceAll("_", " ")} to request the visit.`;
}

export function extractVenueFromKnowledge(knowledge: string): {
  address: string;
  hours: string;
} {
  const lines = knowledge
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const address =
    lines.find((l) =>
      /רחוב|כתובת|address|חולון|תל.?אביב|street|ave\b|road\b/i.test(l),
    ) ?? "";
  const hours =
    lines.find((l) => /שעות|hours|א['׳]-ה|sun.?thu|09:00|9:00/i.test(l)) ?? "";
  return { address, hours };
}

export function tentativeBookingMessage(
  lang: "en" | "he",
  opts: { slot: string; address: string; kind: string },
): string {
  const kindHe = opts.kind === "home" ? "מדידה בבית" : "ביקור באולם";
  const kindEn = opts.kind === "home" ? "an in-home measurement" : "a showroom visit";
  if (lang === "he") {
    const addr = opts.address
      ? `\nכתובת האולם: ${opts.address}`
      : "";
    return `ההזמנה נקלטה במערכת (${kindHe}, ${opts.slot}). הצוות יאשר או יעדכן אותך בהקדם.${addr}`;
  }
  const addr = opts.address ? `\nShowroom address: ${opts.address}` : "";
  return `Request received for ${kindEn} (${opts.slot}). The team will confirm shortly.${addr}`;
}

export function meetingApprovedMessage(
  lang: "en" | "he",
  opts: { slot: string; address: string; hours: string; kind: string },
): string {
  const kindHe = opts.kind === "home" ? "מדידה בבית" : "ביקור באולם";
  const kindEn = opts.kind === "home" ? "in-home measurement" : "showroom visit";
  if (lang === "he") {
    const lines = [
      `הפגישה אושרה (${kindHe}).`,
      `מועד: ${opts.slot}`,
    ];
    if (opts.address) lines.push(`כתובת: ${opts.address}`);
    if (opts.hours) lines.push(`שעות פתיחה: ${opts.hours}`);
    lines.push("מחכים לך.");
    return lines.join("\n");
  }
  const lines = [`Your ${kindEn} is confirmed.`, `When: ${opts.slot}`];
  if (opts.address) lines.push(`Address: ${opts.address}`);
  if (opts.hours) lines.push(`Hours: ${opts.hours}`);
  return lines.join("\n");
}

export function meetingRejectedMessage(lang: "en" | "he"): string {
  return lang === "he"
    ? "לצערנו המועד לא אושר. מתי נוח לתאם מחדש?"
    : "That slot could not be confirmed. When would you like to reschedule?";
}

export function askedNeedlessVenueQuestion(reply: string): boolean {
  return /מידע נוסף|צורך במידע|need (?:any )?more (?:info|information)|like (?:an? )?address|כמו כתובת/i.test(
    reply,
  );
}
