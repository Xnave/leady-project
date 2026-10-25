/**
 * Model-written WhatsApp text (reply tool and nudges).
 * Rails copy (confirm, field asks) does not pass through here.
 */
import { bookingActiveGapReply } from "./capabilities/booking";
import type { TurnContext } from "./types";

const CALENDAR_RE = /calendar link|קישור\s+(?:ישיר\s+)?(?:ל)?יומן|ליומן שלנו/i;
const SAVED_RE =
  /(?:visit|meeting|request|demo|פגישה|בקשה|דמו).{0,48}(?:saved|submitted|scheduled|recorded|נרשמ|נקבע|נשמר)|(?:saved|submitted|scheduled|recorded|רשמתי|שמרתי|קבעתי).{0,48}(?:visit|meeting|request|demo|פגישה|בקשה|דמו)/i;

function digits(text: string): string {
  return text.replace(/\D/g, "");
}

function phoneRuns(text: string): string[] {
  const re = /(?:\+\d[\d\s().-]{6,}\d|\b0\d[\d\s().-]{6,}\d)/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const run = digits(match[0]);
    if (run.length >= 9 && run.length <= 15) out.push(run);
  }
  return out;
}

function urls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>)\]]+/gi)].map((m) =>
    m[0].replace(/[.,!?]+$/g, ""),
  );
}

/** True when model text invents a phone, a link, a calendar offer, or a saved visit. */
export function modelOutboundViolation(text: string, knowledge: string): boolean {
  if (CALENDAR_RE.test(text) || SAVED_RE.test(text)) return true;
  const known = digits(knowledge);
  if (phoneRuns(text).some((run) => !known.includes(run))) return true;
  if (urls(text).some((url) => !knowledge.includes(url))) return true;
  return false;
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Drop a line-leading period, and a repeated opening letter ("ה הכוונה"). */
export function tidyOutbound(text: string): string {
  const lines = text.split("\n").map((line) => line.replace(/^\.\s*/, "").trimEnd());
  const joined = lines.filter((line) => line.length > 0).join("\n").trim();
  return joined.replace(/^(\p{Script=Hebrew})\s+\1/u, "$1");
}

/**
 * Keep model text that only uses phones and URLs from knowledge.
 * While booking collection is open, a violation is replaced by the open gap ask.
 * An empty result means nothing safe is left to send.
 */
export function sanitizeModelOutbound(text: string, ctx: TurnContext): string {
  const tidy = tidyOutbound(text);
  const knowledge = ctx.agent.knowledgeText ?? "";
  if (!modelOutboundViolation(tidy, knowledge)) return tidy;
  const gap = bookingActiveGapReply(ctx);
  if (gap) return gap;
  return sentences(tidy)
    .filter((sentence) => !modelOutboundViolation(sentence, knowledge))
    .join(" ")
    .trim();
}

/**
 * Reply-tool text. A booking gap replaces a cleared message.
 * An empty string means nothing new is sent, and the last reply stays.
 */
export function outboundReply(text: string, ctx: TurnContext): string {
  return sanitizeModelOutbound(text, ctx);
}
