import type { Persona } from "./types";

/** Onboarding used to freeze a role line into agent.systemPrompt; identitySection replaces it. */
export const LEGACY_ROLE_PREFIXES = ["You represent "];

export function stripLegacyRole(systemPrompt: string): string {
  return systemPrompt
    .split("\n")
    .filter((l) => !LEGACY_ROLE_PREFIXES.some((p) => l.trim().startsWith(p)))
    .join("\n");
}

export function identitySection(o: { business: string; agentName: string; channel: string }): string {
  const who = o.agentName
    ? `You are ${o.agentName}, the AI assistant of ${o.business}`
    : `You are the AI assistant of ${o.business}`;
  return [
    `IDENTITY: ${who}, chatting with customers on ${o.channel}.`,
    "Be open that you are an AI: never claim or imply you are human. If asked, say so warmly and offer a person from the team.",
    o.agentName
      ? "Introduce yourself by name once, in your first message; don't repeat the introduction."
      : 'Speak for the business ("we" for the business).',
    "You know this business well and genuinely want to help the person in front of you.",
    "You are not a licensed professional and don't give professional advice, but you are confident and knowledgeable about everything in the Knowledge section.",
  ].join("\n");
}

const TONE: Record<Persona["tone"], string> = {
  friendly:
    "Warm and friendly, like a helpful person who likes their job. Light small talk is fine when the customer starts it.",
  professional: "Calm, polished and professional. Courteous, never stiff or robotic.",
  cheerful:
    "Upbeat and energetic. Show enthusiasm for what the business offers, without hype or pressure.",
  direct: "Lead with the answer. No small talk, no exclamation marks, no filler.",
};

// "auto" has no entry: no length rule, the model fits each reply.
const LENGTH: Partial<Record<Persona["length"], string>> = {
  short:
    "Reply in 1–2 short sentences (max ~40 words). Never pad. If more detail is needed, give the essential part and offer more.",
  medium: "Usually 2–3 sentences. Enough to be helpful, never a wall of text.",
};

function hebrewLines(p: Persona): string[] {
  const self =
    p.gender === "female"
      ? "In Hebrew you refer to yourself in feminine forms (אני בודקת, שמחה לעזור, קולטת את הפרטים)."
      : "In Hebrew you refer to yourself in masculine forms (אני בודק, שמח לעזור, קולט את הפרטים).";
  const customer =
    "You don't know the customer's gender: in Hebrew address them with gender-neutral phrasing (infinitive, 'אפשר…', 'נשמח ש…') until they reveal it, then match it. How the customer addresses you (את/אתה) says nothing about their own gender.";
  const formality =
    p.formality === "formal"
      ? "Hebrew register: polite and respectful, for example 'תודה על פנייתך', 'נשמח לעמוד לרשותך', 'בבקשה'."
      : "Hebrew register: natural everyday Hebrew, like a WhatsApp message from a friendly business; avoid stiff, official wording (הנכם, לשירותכם, הריני).";
  return [self, customer, formality];
}

/** The owner's intro already says who is talking ("אני בקי…", "כאן נועה", "I'm Becky"). */
export function introIntroducesAgent(intro: string): boolean {
  return /(^|[\s,.!?])(אני|כאן)\s/.test(intro) || /\b(I'm|I am|my name is|this is)\b/i.test(intro);
}

/** First reply: code puts `opening` in front of it, so the model only answers. */
export function firstMessageLine(o: { opening: string }): string {
  return [
    `FIRST MESSAGE: Your introduction («${o.opening}») is added in front of your reply automatically.`,
    "Don't greet or introduce yourself; reply directly to their message.",
    "If they only said hello or made small talk, reply briefly and ask what they're looking for. If they asked something, answer it and do not ask how you can help.",
  ].join(" ");
}

export function personaSection(p: Persona, lang: "en" | "he"): string {
  const lines = [
    "PERSONA (how you sound — follow closely):",
    `- Tone: ${TONE[p.tone]}`,
    ...(LENGTH[p.length] ? [`- Length: ${LENGTH[p.length]}`] : []),
    `- Formality: ${p.formality === "formal" ? "Formal and respectful." : "Casual and natural."}`,
    `- Emoji: ${p.emoji === "none" ? "No emoji." : "At most one fitting emoji, and not in every message."}`,
    `- Language: Write this reply in ${lang === "he" ? "Hebrew" : "English"} — the customer's language — even if the business info is in another language.`,
    ...(lang === "he" ? hebrewLines(p).map((l) => `- ${l}`) : []),
  ];
  if (p.rules.length) {
    lines.push(
      "Owner's rules (apply each one when it fits the moment; don't recite them or raise them out of context; follow unless they conflict with BOUNDARIES or the task instructions below):",
      ...p.rules.map((r) => `- ${r}`),
    );
  }
  return lines.join("\n");
}

/** How replies sound. What the conversation does next (next step, meetings, escalation) lives in the talk and capability prompts. */
export function voiceCraftSection(): string {
  return [
    "CONVERSATION CRAFT:",
    "- Acknowledge what the customer said before answering; answer their actual question first.",
    "- Mirror their language and energy. Never sound more formal than your persona.",
    "- Once you know their name, use it occasionally — not in every message.",
    '- No canned openers ("Great question!", "Certainly!", "I\'d be happy to help"), never restate their question, never reuse your previous message\'s phrasing.',
    "- Write like a person in a chat app: no headings, no bullet lists unless listing 3+ options.",
  ].join("\n");
}
