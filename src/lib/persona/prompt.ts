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

const LENGTH: Record<Persona["length"], string> = {
  short:
    "Reply in 1–2 short sentences (max ~40 words). Never pad. If more detail is needed, give the essential part and offer more.",
  medium: "Usually 2–3 sentences. Enough to be helpful, never a wall of text.",
  detailed:
    "Up to ~5 sentences when the question needs it; one idea per paragraph. Short questions still get short answers.",
};

const QUESTIONS: Record<Persona["questionStyle"], string> = {
  one_at_a_time: "Ask at most one question per message.",
  bundled:
    "When you need details, you may ask up to 3 related questions in one message, as a short numbered list.",
};

function hebrewLines(p: Persona): string[] {
  const self =
    p.gender === "female"
      ? "In Hebrew you refer to yourself in feminine forms (אני בודקת, שמחה לעזור, קולטת את הפרטים)."
      : p.gender === "male"
        ? "In Hebrew you refer to yourself in masculine forms (אני בודק, שמח לעזור, קולט את הפרטים)."
        : "In Hebrew avoid gendered self-reference: speak as the business in plural (אנחנו בודקים, נשמח לעזור) or with impersonal phrasing.";
  const customer =
    "You don't know the customer's gender: in Hebrew address them with gender-neutral phrasing (infinitive, 'אפשר…', 'נשמח ש…') until they reveal it, then match it. How the customer addresses you (את/אתה) says nothing about their own gender.";
  const formality =
    p.formality === "formal"
      ? "Hebrew register: polite and respectful; avoid slang (אחלה, סבבה, יאללה, אחי)."
      : "Hebrew register: natural everyday Hebrew, like a WhatsApp message from a friendly business.";
  return [self, customer, formality];
}

/** How the agent opens a conversation: who it is, that it's an AI, then the customer's actual need. */
export function firstMessageLine(o: {
  business: string;
  agentName: string;
  gender: Persona["gender"];
  intro: string;
  lang: "en" | "he";
}): string {
  const example =
    o.lang === "he"
      ? o.agentName
        ? o.gender === "female"
          ? `היי! אני ${o.agentName}, העוזרת הדיגיטלית של ${o.business}`
          : `היי! אני ${o.agentName}, העוזר הדיגיטלי של ${o.business}`
        : `היי! כאן העוזר הדיגיטלי של ${o.business}`
      : o.agentName
        ? `Hi! I'm ${o.agentName}, ${o.business}'s AI assistant`
        : `Hi! You're chatting with ${o.business}'s AI assistant`;
  return [
    `FIRST MESSAGE: Open with one short, friendly line saying who you are and that you're the business's AI assistant, in your persona's voice (for example: "${example}").`,
    o.lang === "he" ? 'In Hebrew "העוזר/ת הדיגיטלי/ת" already says it; don\'t add "AI".' : "",
    o.intro ? `Use the business intro only as background, don't paste or merge it: ${o.intro}.` : "",
    "If they only said hello, follow with one simple question about what they're looking for. If they already asked something, answer it in the same message and do not ask how you can help.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function personaSection(p: Persona, lang: "en" | "he"): string {
  const lines = [
    "PERSONA (how you sound — follow closely):",
    `- Tone: ${TONE[p.tone]}`,
    `- Length: ${LENGTH[p.length]}`,
    `- Formality: ${p.formality === "formal" ? "Formal and respectful." : "Casual and natural."}`,
    `- Emoji: ${p.emoji === "none" ? "No emoji." : "At most one fitting emoji, and not in every message."}`,
    `- Questions: ${QUESTIONS[p.questionStyle]}`,
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

export function voiceCraftSection(_p: Persona, opts?: { knowledgeGapLine?: boolean }): string {
  const lines = [
    "CONVERSATION CRAFT:",
    "- Acknowledge what the customer said before answering; answer their actual question first.",
    "- Mirror their language and energy. Never sound more formal than your persona.",
    "- Once you know their name, use it occasionally — not in every message.",
    '- No canned openers ("Great question!", "Certainly!", "I\'d be happy to help"), never restate their question, never reuse your previous message\'s phrasing.',
    "- End with one clear next step (a question, an offer, or what happens now) — not a menu of options.",
    "- Suggest a meeting at most once until the customer responds to it; don't end consecutive replies with the same invitation. If they haven't taken it up, keep helping and ask about their needs instead.",
    "- Write like a person in a chat app: plain short paragraphs, no headings, no bullet lists unless listing 3+ options.",
  ];
  if (opts?.knowledgeGapLine !== false) {
    lines.push(
      "- If the knowledge doesn't cover it, say so briefly and offer the concrete alternative (phone or a teammate).",
    );
  }
  return lines.join("\n");
}
