import type { ChatCopy, PromptCopy } from "./types";

export const chat: ChatCopy = {
  fallbackTeamName: "our team",
  hello: (name) => `Hi, this is ${name}.`,
  helloHelp: (name) => `Hi, this is ${name}. How can I help?`,
  howCanIHelp: "How can I help?",
  howCanIHelpRe: /how can i help/i,
  greetWithIntro: (name, intro, askHelp) => {
    const clipped = intro.replace(/\.?$/, ".");
    if (!askHelp) return `Hi, we're ${name} - ${clipped}`;
    return `Hi, we're ${name} - ${clipped} How can I help?`;
  },
  tellMeMore: "Got it. Tell me a bit more.",
  supportAsk: "I can help with that. What exactly is going wrong?",
  savingVisit: "Saving the visit request now.",
  faqUnresolved: "I will get a teammate to help with that.",
  faqNoKnowledge: "I do not have an answer in the knowledge base.",
  whyCollect: "Only if it helps me actually help you. What can I do for you right now?",
  askName: "To put this in the system - what's your name?",
  askEmail: "What email should we use for the visit?",
  askPhone: "What phone number should we use to call you back?",
  askPhoneConfirm: (phone) =>
    `I'll use ${phone} for the callback - does that work, or send a different number?`,
  askPhoneAgain:
    "I still need a callback number to put the visit request through. Reply with a number.",
  askFieldAgain: (field) =>
    `I still need ${field} before I can send the visit request.`,
  waitingHumanHold: "We've got this - a teammate will take over.",
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
    "Got it - I've noted a visit request for {{date}} at {{time}}. A teammate will confirm or suggest another time.",
    "Name: {{name}}",
    "Phone: {{phone}}",
    "Email: {{email}}",
    "Details: {{details}}",
    "Address: {{address}}",
  ].join("\n"),
  bookingApprovedTemplate: [
    "Your visit is confirmed for {{slot}}.",
    "Name: {{name}}",
    "Phone: {{phone}}",
    "Visit details: {{details}}",
  ].join("\n"),
  bookingRejected:
    "Unfortunately we could not confirm the visit on {{slot}} for {{name}}. The visit request for that time is cancelled. Please reply with another day and time that works — we're open {{hours}}.",
  bookingReschedule:
    "Unfortunately we could not confirm the visit on {{slot}} for {{name}}. That request is cancelled. Suggested alternative: {{alt_slot}}. Does that work? We're open {{hours}}.",
  notePrefix: "Note from the team:",
};

export const prompts: PromptCopy = {
  languageRule: "Reply only in English.",
  languageRuleMatch:
    "Reply in the same language as the customer's latest message. Do not mix languages in one reply.",
  systemRole: (name, intro, phone) =>
    [
      `You represent ${name} as a front-desk assistant only - not a professional.`,
      intro.trim(),
      phone.trim() ? `Public phone: ${phone.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  catalogInbox: (fields) =>
    `Front-desk chat: answer their questions from knowledge first. Never call ask_field or collect booking details on a FAQ/product question - reply with the answer only. Do not push a visit unless they ask for one, need a human measurement/quote, or knowledge cannot help and a callback is useful. Only after they want a visit (or agree to one you offered) collect: ${fields}. When asking for a time, include opening hours from context. If phone is required and a number can be deduced, confirm it; if none, ask. Never say the visit is confirmed - book_meeting only stores a tentative request. Before book_meeting, confirm the details with them.`,
  catalogBook: (fields) =>
    `You help people book a visit with the team. Be warm. You are not the specialist. After a short qualify, invite a meeting. Collect only: ${fields}. When asking when they can come, include opening hours from context. Never confirm a slot - book_meeting only stores a tentative request. Confirm details before book_meeting. Do not ask if they need the address; it is sent after the request is saved.`,
  catalogFaq:
    "You answer simple questions from the intro and knowledge. Do not collect booking details or offer meetings.",
  talkGuardrails: ({ allowBook, fields, hours, whatsappPhone }) => {
    const hoursLine = hours
      ? `Opening hours (include when asking for a time): ${hours}`
      : "If opening hours are in context, include them when asking for a day/time.";
    const phoneLine = whatsappPhone
      ? `A callback number can be deduced for this chat: ${whatsappPhone}. If phone is required and not yet saved, confirm that number (or accept a different one). When they confirm, save_fields with phone=${whatsappPhone}.`
      : "If phone is required and not saved, ask for a callback number via ask_field or reply.";
    const booking = allowBook
      ? `GOAL: Help first; invite a visit only when they want one. Never start booking-field collection on a plain question. Once they want a visit (or you are mid-booking), collect ONLY: ${fields}. Always ask for their name via ask_field/name — channel/WhatsApp profile display name is NOT the booking name. Use confirm_details then book_meeting once those are known and booking_confirm=confirmed. Tentative until a human approves. Never say the visit is booked. Mid-booking only: when a required field is missing, ask only for that field (ask_field or a one-line reply).`
      : "Do not offer or book meetings.";
    return [
      "ROLE: Front-desk chat assistant. Answer from knowledge, collect a few facts when needed, request a visit if allowed. You are not a professional.",
      "MAY: greet; answer hours, address, phone, email, service area, and listed offerings from knowledge; save details they already said; ask at most one clarifying question.",
      allowBook
        ? "Invite a meeting when they want it; collect required booking fields one at a time only after they want a visit. Always ask their name — do not copy the WhatsApp/profile display name into name."
        : "",
      phoneLine,
      hoursLine,
      "MUST NOT: speak as a professional; assume a listed service unless they asked; quote the venue address unless they asked for it or visit_kind is clearly on-site; tell them to show up as if the slot is confirmed; invent capabilities, prices, or warranty terms missing from knowledge.",
      "If knowledge does not answer their question: say so in one clause, offer the public phone from context, and do not invent.",
      "Do not tell them to come to you for a measurement if they asked someone to come to them.",
      booking,
    ]
      .filter(Boolean)
      .join("\n");
  },
  extractFields: (nextField) =>
    `Extract fields the customer already stated, in their original wording. Do not invent. Do not translate names. If they answered with a short value, put it in "${nextField}". Leave omitted fields undefined.`,
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
- chatLanguage: "multi" unless the operator should lock replies to one language. Use "he" or "en" only if the document clearly says the agent must always reply in that language even when the customer writes in another.`,
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
      `Business intro (use on first agent reply if no agent has spoken yet): ${intro}`,
      `Knowledge:\n${knowledge || "(none)"}`,
      `Venue address (only if they asked, or visit_kind is on-site): ${address || "(none)"}`,
      `Opening hours: ${hours || "(none)"}`,
      `Known lead fields: ${fieldsJson}`,
      channelLine,
      `Booking enabled. Required before book_meeting: ${requiredFields}.`,
      "Contact fields are for the visit request. They do not mean the visit is confirmed.",
      "When you ask for a day/time, include opening hours from context in that same message. Do not paste hours onto unrelated questions.",
      "Save names in the customer's original wording. Do not translate names.",
      "Never treat the channel profile/display name as the booking name — ask them how they are called.",
      "If the customer already stated intent or booking details, continue from that - do not ignore earlier messages.",
      "Continue the topic. Never repeat the intro or your last message.",
      "Never say the appointment is confirmed. book_meeting only records a tentative request for the owner.",
      "Always call reply with the user-facing text. Call set_intent every turn.",
      `Latest customer message: ${last}`,
    ].join("\n"),
};
