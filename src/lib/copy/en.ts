import type { ChatCopy, PromptCopy } from "./types";

export const chat: ChatCopy = {
  fallbackTeamName: "our team",
  hello: (name) => `Hi, this is ${name}.`,
  helloHelp: (name) => `Hi, this is ${name}. How can I help?`,
  howCanIHelp: "How can I help?",
  howCanIHelpRe: /how can i help/i,
  greetWithIntro: (name, intro, askHelp) => {
    const clipped = intro.replace(/\.?$/, ".");
    if (!askHelp) return `Hi, we're ${name} — ${clipped}`;
    return `Hi, we're ${name} — ${clipped} How can I help?`;
  },
  tellMeMore: "Got it. Tell me a bit more.",
  supportAsk: "I can help with that. What exactly is going wrong?",
  savingVisit: "Saving the visit request now.",
  faqUnresolved: "I will get a teammate to help with that.",
  faqNoKnowledge: "I do not have an answer in the knowledge base.",
  whyCollect: "Only if it helps me actually help you. What can I do for you right now?",
  askName: "To put this in the system — what's your name?",
  askEmail: "What email should we use for the visit?",
  askPhone:
    "What phone number should we use to call you back? Reply with another number if this chat is not the one.",
  askNeed: "What should we cover in the visit?",
  askVisitKind: "What kind of visit works for you?",
  askTime: (hours) =>
    hours
      ? `We're open ${hours}. What day and time works for you?`
      : "When works for you? Day and time.",
  askFieldFallback: (field) => `I still need ${field.replaceAll("_", " ")} to request the visit.`,
  availability: (hours) =>
    hours
      ? `We're open ${hours}. What day and time works?`
      : "What day and time works for you?",
  hoursLine: (hours) => `Hours: ${hours}`,
  bookingRequestTemplate: [
    "Request received ({{kind}}, {{slot}}) — tentative. The team will confirm or suggest another time.",
    "Need: {{need}}",
    "Name: {{name}}",
    "Phone: {{phone}}",
    "Email: {{email}}",
    "Address: {{address}}",
  ].join("\n"),
  bookingApprovedTemplate: [
    "Your visit is confirmed ({{kind}}).",
    "When: {{slot}}",
    "Address: {{address}}",
    "Hours: {{hours}}",
  ].join("\n"),
  bookingRejected: "That slot could not be confirmed. When would you like to reschedule?",
};

export const prompts: PromptCopy = {
  languageRule: "Reply only in English.",
  languageRuleMatch:
    "Reply in the same language as the customer's latest message. Do not mix languages in one reply.",
  systemRole: (name, intro, phone) =>
    [
      `You represent ${name} as a front-desk assistant only — not a professional.`,
      intro.trim(),
      phone.trim() ? `Public phone: ${phone.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  catalogInbox: (fields) =>
    `Front-desk chat: greet, answer simple questions from knowledge, then invite a meeting with a human when they want one. Never assume a service they did not ask for. When asking for a time, include the tenant opening hours from context. Collect only these booking fields: ${fields}. If the channel is WhatsApp and a callback phone is already in lead fields, do not ask for phone unless they want a different number. Never say the visit is confirmed — book_meeting only stores a tentative request for the owner.`,
  catalogBook: (fields) =>
    `You help people book a visit with the team. Be warm. You are not the specialist. After a short qualify, invite a meeting. Collect only: ${fields}. When asking when they can come, include opening hours from context. Never confirm a slot — book_meeting only stores a tentative request. Do not ask if they need the address; it is sent after the request is saved.`,
  catalogFaq:
    "You answer simple questions from the intro and knowledge. Do not collect booking details or offer meetings.",
  talkGuardrails: ({ allowBook, fields, hours, whatsappPhone }) => {
    const hoursLine = hours
      ? `Opening hours (include when asking for a time): ${hours}`
      : "If opening hours are in context, include them when asking for a day/time.";
    const phoneLine = whatsappPhone
      ? `WhatsApp callback already known for this tenant's chat: ${whatsappPhone}. Do not ask for phone unless they want a different number.`
      : "Ask for phone only if it is in the required booking fields and not already saved.";
    const booking = allowBook
      ? `GOAL: After a few facts, invite a visit. Collect ONLY: ${fields}. Call book_meeting once those are known. That is TENTATIVE until a human approves. Never say the visit is booked or "see you then".`
      : "Do not offer or book meetings.";
    return [
      "ROLE: Front-desk chat assistant. Collect a few facts, answer from knowledge, request a visit if allowed. You are not a professional. The knowledge file is what the COMPANY does — you do not perform those services in chat.",
      "MAY: greet; answer hours, address, phone, email, service area, and listed offerings from knowledge; save details they already said; ask at most one clarifying question.",
      allowBook
        ? "Invite a meeting; if they want it, collect required booking fields one at a time."
        : "",
      phoneLine,
      hoursLine,
      "MUST NOT: speak as a professional; assume a listed service unless they asked; ask if they need the address; tell them to show up as if the slot is confirmed; invent capabilities or prices missing from knowledge.",
      booking,
    ]
      .filter(Boolean)
      .join("\n");
  },
  extractFields: (nextField) =>
    `Extract fields the customer already stated. Do not invent. If they answered with a short value, put it in "${nextField}". Leave omitted fields undefined.`,
  draftQuestion: (nextField) =>
    `Ask only for: ${nextField}. One short message. If they asked why, explain in one clause then ask for ${nextField}.`,
  faqSystem: (prompt, knowledge) =>
    `${prompt}\nKnowledge:\n${knowledge}\nIf the knowledge does not answer, reply with exactly UNRESOLVED.`,
  extractOnboard: `Extract setup fields for a front-desk chat agent from this business document.
Do not invent. Omit a field if it is not clearly in the text.
- name: official business name
- phone: public customer-facing phone
- intro: 1–3 sentences the agent should say as this business (same language as the document)
- venueAddress: street address customers visit, if any
- venueHours: opening hours as a short phrase (e.g. Sun–Thu 09:00–19:00)
- chatLanguage: "he" if the document is Hebrew, "en" if English, "multi" if mixed or unclear`,
  talkContext: ({
    business,
    intro,
    knowledge,
    fieldsJson,
    channelLine,
    requiredFields,
    hours,
    address,
    last,
  }) =>
    [
      `Business: ${business}`,
      `Canned intro already sent (do not repeat it): ${intro}`,
      `Knowledge:\n${knowledge || "(none)"}`,
      `Venue address: ${address || "(none)"}`,
      `Opening hours: ${hours || "(none)"}`,
      `Known lead fields: ${fieldsJson}`,
      channelLine,
      `Booking enabled. Required before book_meeting: ${requiredFields}.`,
      "Contact fields are for the visit request. They do not mean the visit is confirmed.",
      "When you ask for a day/time, include opening hours from context in that same message.",
      "Continue the topic. Never repeat the intro or your last message.",
      "Never say the appointment is confirmed. book_meeting only records a tentative request for the owner.",
      "Always call reply with the user-facing text.",
      `Latest customer message: ${last}`,
    ].join("\n"),
};
