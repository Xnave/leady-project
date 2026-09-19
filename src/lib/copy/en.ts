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
  askName: "To put this in the system — what's your full name?",
  askEmail: "What email should we use for the visit?",
  askPhone: "What phone number should we use to call you back?",
  askPhoneConfirm: (phone) =>
    `I'll use ${phone} for the callback - does that work, or send a different number?`,
  askPhoneAgain:
    "I still need a callback number to put the visit request through. Reply with a number.",
  askFieldAgain: (field) =>
    `I still need ${field} before I can send the visit request.`,
  waitingHumanHold: "We've got this - a teammate will take over.",
  askNeed: "In a few words — what should we know ahead of the visit?",
  askVisitKind: "What kind of visit works for you?",
  askTime: (hours) =>
    hours
      ? `We're open ${hours}. What day and time works for you?`
      : "What day and time works for you?",
  askFieldFallback: (field) => `I still need ${field.replaceAll("_", " ")} to request the visit.`,
  askFieldWithOptions: (field, options) =>
    `Which ${field.replaceAll("_", " ")} works for you? Options: ${options}`,
  availability: (hours) =>
    hours
      ? `We're open ${hours}. What day and time works for you?`
      : "What day and time works for you?",
  hoursLine: (hours) => `Hours: ${hours}`,
  askTimeOutsideHours: (hours) =>
    hours
      ? `That time is outside our opening hours (${hours}). What other day and time works for you?`
      : "That time is outside our opening hours. What other day and time works for you?",
  bookingRequestTemplate: [
    "Got it - I've noted a visit request for {{date}} at {{time}}. A teammate from {{business}} will confirm or suggest another time.",
    "Name: {{name}}",
    "Phone: {{phone}}",
    "Email: {{email}}",
    "Visit details: {{details}}",
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
  request: {
    askField: (label) => `What is your ${label}?`,
    confirmTitle: (noun) => `${noun} details:`,
    confirmAsk: "Do these details look correct?",
    needValidDates:
      "Need valid start and end dates (end after start) before checking availability.",
    invalidDates: "The start/end dates are invalid.",
    stillNeed: (gaps) => `Still need: ${gaps}`,
    availabilityNotConfigured:
      "Automatic availability check is not configured — a teammate will verify or we can send a booking link.",
    datesUnavailable: (url) =>
      url
        ? `Those dates are unavailable. Try other dates or open: ${url}`
        : "Those dates are unavailable.",
    datesAvailable: "Those dates look available on the online calendar.",
    availabilityUnknownLink: (url) =>
      `I could not confirm availability for sure. You can check and book here: ${url}`,
    availabilityUnknownHitl:
      "I could not confirm availability for sure — I will have a teammate verify.",
    defaultRequest: ({ noun, from, to, details }) =>
      `I recorded a ${noun} request from ${from} to ${to}${details ? ` · ${details}` : ""}. A teammate will confirm or suggest other dates.`,
    defaultApproved: (noun, from, to) =>
      `Your ${noun} from ${from} to ${to} is confirmed. We look forward to seeing you.`,
    defaultRejected: (noun, from, to, note) =>
      `Unfortunately we could not confirm a ${noun} for ${from}–${to}.${note ? ` ${note}` : ""}`,
    completeBookingLink: (url) => `To complete booking: ${url}`,
    offerAltDates: (from, to) =>
      `Those dates are not available. Does ${from} to ${to} work instead?`,
    offerDeclineAsk: "No problem — which other dates work for you?",
    offerUnclearAsk: "Just to confirm — do the offered dates work for you?",
  },
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
    `Front-desk chat: answer from knowledge first with the reply tool. Product interest (e.g. "I want a WhatsApp agent", "how does it work", pricing, features) is NOT a booking request — explain the offering, then ask if they want to schedule a call/visit. Never call ask_field, start_booking, or collect booking details until they explicitly ask to schedule a meeting/visit/demo/call or clearly accept an offer to book. Do not push a visit on a plain question. Only after an explicit schedule request collect: ${fields}. Never say the visit is confirmed - book_meeting only stores a tentative request.`,
  catalogBook: (fields) =>
    `You help people learn about the business and book a visit when ready. Be warm. You are not the specialist. Answer product questions from knowledge before collecting booking fields. Only after they explicitly want to schedule, collect: ${fields}. Never confirm a slot - book_meeting only stores a tentative request. Confirm details before book_meeting.`,
  catalogFaq:
    "You answer simple questions from the intro and knowledge. Do not collect booking details or offer meetings.",
  talkGuardrails: ({ allowBook, fields, hours, whatsappPhone }) => {
    const hoursLine = hours
      ? `Opening hours (for context only): ${hours}. When asking for a day/time, phrase hours in natural language — never paste this string verbatim as the message.`
      : "If opening hours are in context, phrase them naturally when asking for a day/time — never dump a raw hours string.";
    const phoneLine = whatsappPhone
      ? `A callback number can be deduced for this chat: ${whatsappPhone}. If phone is required and not yet saved, confirm that number (or accept a different one). When they confirm, save_fields with phone=${whatsappPhone}.`
      : "If phone is required and not saved, ask for a callback number via ask_field or reply.";
    const booking = allowBook
      ? `GOAL: Help first with reply from knowledge. Interest in the product/service is NOT enough to start booking. Call start_booking only when they explicitly ask to schedule a meeting/visit/demo/call (or accept your offer to book). Then collect ONLY: ${fields}. Never say the visit is booked.`
      : "Do not offer or book meetings.";
    return [
      "ROLE: Front-desk chat assistant. Answer from knowledge, collect a few facts when needed, request a visit if allowed. You are not a professional.",
      "MAY: greet; answer hours, address, phone, email, service area, and listed offerings from knowledge; save details they already said; ask at most one clarifying question.",
      allowBook
        ? "Invite a meeting only after explaining if they asked about the product; collect booking fields only after an explicit schedule request via start_booking."
        : "",
      phoneLine,
      hoursLine,
      "MUST NOT: jump to day/time questions on product interest; speak as a professional; invent capabilities, prices, or warranty terms missing from knowledge; tell them the slot is confirmed.",
      "If knowledge does not answer their question: say so in one clause, offer the public phone from context, and do not invent.",
      "Do not call request_human just because they showed sales interest — answer first.",
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
      `Opening hours (phrase naturally when relevant — never paste verbatim as a message): ${hours || "(none)"}`,
      `Known lead fields: ${fieldsJson}`,
      channelLine,
      "Default action: call reply with a helpful answer from knowledge/intro. Do not start booking on product interest alone.",
      `Booking is available later. Required fields when booking starts: ${requiredFields}.`,
      "Contact fields are for the visit request. They do not mean the visit is confirmed.",
      "Save names in the customer's original wording. Do not translate names.",
      "Never treat the channel profile/display name as the booking name — ask them how they are called.",
      `Always refer to the business as "${business}" — never invent a company name from the customer's name (e.g. do not turn "Dana" into "Dana AI").`,
      "Continue the topic. Never repeat the intro or your last message.",
      "Never say the appointment is confirmed. book_meeting only records a tentative request for the owner.",
      "Always call reply with the user-facing text (unless ask_field already set it). Call set_intent every turn.",
      `Latest customer message: ${last}`,
    ].join("\n"),
  nudgeDefaultInstruction:
    "Send a brief friendly follow-up because they have not replied. Continue the same thread; do not repeat the full intro or copy your last message verbatim.",
  nudgeTurn: (instruction) =>
    [
      "MODE: silence nudge (follow-up only).",
      "You are the BUSINESS assistant speaking TO the customer on WhatsApp — never the customer.",
      "The customer (lead) has not replied for a while. Write ONE short outbound message the business sends next.",
      "Continue the open thread from the business side: pick up the last topic or gently re-ask what you were waiting on.",
      "Do NOT impersonate the customer, do NOT answer on their behalf, do NOT write what they might say.",
      "Do NOT prefix with role labels (no 'agent:', 'lead:', 'customer:', 'business:'). Output plain message text only.",
      "Do NOT start a new welcome, do NOT call tools, do NOT confirm visits, do NOT escalate.",
      "Match the customer's language from their latest message.",
      `Operator guidance: ${instruction}`,
    ].join("\n"),
};
