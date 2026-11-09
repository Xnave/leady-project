import { supportedTypeLabels } from "@/lib/documents/file-types";
import type { ChatCopy, PromptCopy } from "./types";

export const chat: ChatCopy = {
  fallbackTeamName: "our team",
  hello: (name) => `Hi, this is ${name}.`,
  assistantIntro: ({ agentName, business }) =>
    agentName ? `Hi! I'm ${agentName}, ${business}'s AI assistant.` : `Hi! You're chatting with ${business}'s AI assistant.`,
  askHowToHelp: "How can I help?",
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
  askName: "What's your full name, so we can book this in?",
  askEmail: "Where should we send the visit confirmation? Drop an email here.",
  askPhone: "What's the best number to call you back on?",
  askPhoneConfirm: (phone) =>
    `Just checking - I'll use ${phone} to reach you. Does that work, or send a different number?`,
  askPhoneAgain:
    "I still need a callback number to put the visit request through. Reply with a number.",
  askFieldAgain: (field) =>
    `I still need ${field} before I can send the visit request.`,
  waitingHumanHold: "We've got this - a teammate will take over.",
  askNeed: "I'd love to prep a useful meeting - what should we know about you or what you'd like to see?",
  askNeedWithGathered: (gathered) =>
    [
      "Great - here's what I've got from our chat so far:",
      gathered,
      "",
      "Anything else we should add ahead of the visit? Feel free to add details, or say you're all set.",
    ].join("\n"),
  bookingConfirmIntro: "Perfect - here's the visit request I have:",
  bookingConfirmAsk: "Do these details look right, and shall I save the request?",
  bookingDeclineAsk: "Okay, I won't save the request. Want to change the time, or stop here?",
  askVisitKind: "What kind of visit works for you?",
  askTime: (hours) =>
    hours
      ? `We're around ${hours}. When would be a good day and time for you?`
      : "When would be a good day and time for you?",
  askFieldFallback: (field) => `I still need ${field.replaceAll("_", " ")} to request the visit.`,
  askFieldWithOptions: (field, options) =>
    `Which ${field.replaceAll("_", " ")} works for you? Options: ${options}`,
  availability: (hours) =>
    hours
      ? `We're around ${hours}. When would be a good day and time for you?`
      : "When would be a good day and time for you?",
  hoursLine: (hours) => `Hours: ${hours}`,
  askTimeOutsideHours: (hours) =>
    hours
      ? `That time is outside our opening hours (${hours}). What other day and time works for you?`
      : "That time is outside our opening hours. What other day and time works for you?",
  askTimeAmbiguous:
    "Did you mean morning or evening? Please say the time clearly (for example 6 in the evening or 18:00).",
  askTimeUnclear: "What day and clock time works for you? Please include a specific hour.",
  askTimeInvalidHours:
    "I can't check our opening hours right now. What other day and time works for you?",
  bookingRequestTemplate:
    "Got it — I've noted a visit request for {{date}} at {{time}}. A teammate from {{business}} will confirm shortly.",
  bookingApprovedTemplate:
    "Your visit is confirmed for {{weekday}}, {{date}} at {{time}}.",
  bookingRejected:
    "Unfortunately we could not confirm the visit on {{slot}} for {{name}}. The visit request for that time is cancelled. Please reply with another day and time that works - we're open {{hours}}.",
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
      "Automatic availability check is not configured - a teammate will verify or we can send a booking link.",
    datesUnavailable: (url) =>
      url
        ? `Those dates are unavailable. Try other dates or open: ${url}`
        : "Those dates are unavailable.",
    datesAvailable: "Those dates look available on the online calendar.",
    availabilityUnknownLink: (url) =>
      `I could not confirm availability for sure. You can check and book here: ${url}`,
    availabilityUnknownHitl:
      "I could not confirm availability for sure - I will have a teammate verify.",
    defaultRequest: ({ noun, from, to, details }) =>
      `I recorded a ${noun} request from ${from} to ${to}${details ? ` · ${details}` : ""}. A teammate will confirm or suggest other dates.`,
    defaultApproved: (noun, from, to) =>
      `Your ${noun} from ${from} to ${to} is confirmed. We look forward to seeing you.`,
    defaultRejected: (noun, from, to, note) =>
      `Unfortunately we could not confirm a ${noun} for ${from}–${to}.${note ? ` ${note}` : ""}`,
    completeBookingLink: (url) => `To complete booking: ${url}`,
    sendBookingLink: (noun, url) =>
      `Great - you can finalise your ${noun} here: ${url}`,
    offerAltDates: (from, to) =>
      `Those dates are not available. Does ${from} to ${to} work instead?`,
    offerDeclineAsk: "No problem - which other dates work for you?",
    offerReplacement: (from, to) =>
      `Noted ${from} to ${to} instead of the offered dates. A teammate will confirm them.`,
    offerUnclearAsk: "Just to confirm - do the offered dates work for you?",
  },
  documents: {
      askId: "To find your file, please send your 9-digit ID number.",
      notFound: "I couldn't find a file with that number. Please check it and send it again.",
      notConfigured: "Document collection hasn't been set up yet. A teammate will follow up shortly.",
      askStage: (docs) => `To move forward, please send ${docs}.`,
      askIdCard: "Please send a photo of your ID card with the appendix.",
      askPayslips: "Please send payslips for the last 3 months.",
      ownedBy: (label, who) => `${label} for ${who}`,
      forBorrower: (line, who) => `${line.replace(/[.?!]+\s*$/, "")} for ${who}.`,
      borrowerRole: {
        salaried: "the salaried borrower",
        self_employed: "the self-employed borrower",
        controlling_shareholder: "the controlling-shareholder borrower",
        both: "the borrower who is both salaried and self-employed",
      },
      borrowerOrder: { "1": "the first borrower", "2": "the second borrower" },
      askEmployment: (name) =>
        `To tailor the document list, what is ${name}'s employment status — salaried, self-employed, controlling shareholder, or other?`,
      askSecondBorrower: "Is there a second borrower on this file?",
      askCouple: "Is one borrower self-employed and the other salaried?",
      askSplitWho: (first, second) => `Which one is self-employed, ${first} or ${second}?`,
      askIdBiometric: (name) =>
        name ? `Is ${name}'s ID card biometric?` : "Is the ID card biometric?",
      askIdBack: "Please also send the other side of the ID card.",
      askFirstHome: "Is this for the purchase of your first home?",
      askLoans: "Do you currently have any loans?",
      askMoreLoans: "Do you have another loan?",
      askAccounts: "Please also send a bank statement for the last three months.",
      askSalaryDeposit: (name) =>
        `Is the salary shown on ${name}'s payslip deposited into their personal bank account?`,
      askMorePhotos: "Do you have any more photos of this same document?",
      howTo: (docType) => {
        const steps: Record<string, string> = {
          loan_balances: "The loan balance is still required. You can download it from your bank's website or app, or ask the bank for a payoff balance, and send it here.",
          bank_statement: "A statement for the last three months can be exported as a PDF from your bank's website or app.",
          id_card: "You can photograph the ID card with the appendix on your phone, in good light, so the details are readable.",
          id_card_back: "You can photograph the other side of the ID card on your phone, in good light.",
          id_appendix: "You can photograph the ID appendix on your phone so every line is visible.",
          payslip: "Payslips for the last three months can be downloaded from the employee portal or requested from the employer.",
          tax_assessment: "A tax assessment, or a tax-file opening confirmation, can be downloaded from the tax authority site or requested from the accountant.",
          accountant_letter: "You can ask the accountant to complete the form and send it back here.",
          controlling_shareholder_letter: "You can ask the accountant for the controlling-shareholder letter and send it here.",
        };
        return steps[docType] ?? "You can get this document from the office that issues it and send it here as a file or a photo.";
      },
      howToDetail: (docType) => {
        const steps: Record<string, string> = {
          loan_balances: "On the bank's website or app, open Loans and download a payoff balance, or ask the branch for that letter, and save it as a PDF.",
          bank_statement: "On the bank's website or app, open the current account and export the last three months, not the current month, as a PDF.",
          id_card: "Photograph the ID card together with the appendix, in good light, so the name and number are readable.",
          id_card_back: "Turn the ID card over and photograph the other side. A driving licence does not count.",
          id_appendix: "Photograph the whole appendix page so every line is visible.",
          payslip: "In the employee portal, or by asking the employer, download the payslips for the last three months.",
          tax_assessment: "Sign in to the tax authority personal area, choose the tax assessment or the tax-file opening confirmation for the tax year, and download the PDF. If you cannot sign in, the accountant can issue it.",
          accountant_letter: "Send the accountant the blank form attached here and ask them to complete it for the current year and return a PDF.",
          controlling_shareholder_letter: "Ask the accountant for the controlling-shareholder letter as a PDF and send it here.",
        };
        return steps[docType] ?? "Ask the office that issues this document for a current copy, and send it here as a file or a photo.";
      },
      revised: (kind, detail) => {
        const employment: Record<string, string> = {
          salaried: "salaried",
          self_employed: "self-employed",
          controlling_shareholder: "a controlling shareholder",
          both: "both salaried and self-employed",
          other: "other",
        };
        if (kind === "loans_known") return "Noted that there are loans. We'll ask for the balance when we get to it.";
        if (kind === "employment") return `Noted that the employment is ${employment[detail ?? ""] ?? "updated"}.`;
        if (kind === "second_yes") return "Noted that there is a second borrower.";
        if (kind === "second_no") return "Noted that there is no second borrower.";
        if (kind === "first_home_yes") return "Noted that this is a first home.";
        if (kind === "first_home_no") return "Noted that this is not a first home.";
        if (kind === "couple_yes") return "Noted that one borrower is self-employed and the other is salaried.";
        if (kind === "couple_no") return "Noted that this is not one self-employed borrower and one salaried borrower.";
        if (kind === "split_who" && detail === "2") return "Noted that the second borrower is self-employed and the first is salaried.";
        if (kind === "split_who") return "Noted that the first borrower is self-employed and the second is salaried.";
        if (kind === "salary_yes") return "Noted that the salary is deposited into the personal account.";
        if (kind === "salary_no") return "Noted that the salary is not deposited into the personal account.";
        if (kind === "more_loans") return "Noted that there is another loan.";
        return "Noted the update.";
      },
      retracted: "I've removed the last file. It wasn't the right document.",
      notIdBack: "That is not the other side of the ID card. Please send the other side of the card.",
      idBackTryAgain: "I couldn't read that photo. Please send it again.",
      confirmChange: (kind, detail) => {
        const employment: Record<string, string> = {
          salaried: "salaried",
          self_employed: "self-employed",
          controlling_shareholder: "a controlling shareholder",
          both: "both salaried and self-employed",
          other: "other",
        };
        if (kind === "retract" && detail === "id_card_back") return "remove the other side";
        if (kind === "retract") return "remove the last file";
        if (kind === "employment") return `record the employment as ${employment[detail ?? ""] ?? "updated"}`;
        if (kind === "loans" && detail === "none") return "record that there are no loans";
        if (kind === "loans") return "record that there are loans";
        if (kind === "second_borrower" && detail === "no") return "record that there is no second borrower";
        if (kind === "second_borrower") return "record that there is a second borrower";
        if (kind === "first_home" && detail === "false") return "record that this is not a first home";
        if (kind === "first_home") return "record that this is a first home";
        if (kind === "couple_split" && detail === "no") return "record that this is not one self-employed borrower and one salaried borrower";
        if (kind === "couple_split") return "record that one borrower is self-employed and the other is salaried";
        if (kind === "split_who" && detail === "2") return "record that the second borrower is self-employed and the first is salaried";
        if (kind === "split_who") return "record that the first borrower is self-employed and the second is salaried";
        if (kind === "salary_deposit" && detail === "no") return "record that the salary is not deposited into the personal account";
        if (kind === "salary_deposit") return "record that the salary is deposited into the personal account";
        if (kind === "more_loans" && detail === "no") return "record that there is no other loan";
        if (kind === "more_loans") return "record that there is another loan";
        if (kind === "how_to") return "explain where to get the document";
        return "update what you said";
      },
      confirmTurn: (changes) => `Just to confirm: ${changes.join(", ")}?`,
      noLoans: "Noted that there are no loans, so a loan balance is not needed.",
      blankForm: (doc) => `I've attached the ${doc} form. Please complete it and send it back here.`,
      nextStage: "We can move on to the next step. I'll send the next document list as soon as it's ready.",
      advisorFlag: (label) =>
        `One detail needs the consultant's review: ${label}. In the meantime, you can send the ID and its appendix.`,
      received: (doc) => `I've received the ${doc}.`,
      rejected: (doc, reason, detail) => `I couldn't approve the ${doc}: ${reason}.${detail ? ` ${detail}` : ""}`,
      complete: "The documents have been sent for review. We'll contact you once they're processed, and then we can move on to the next step.",
      returnFiles: (items) =>
        `Please send these again:\n${items.map((item) => `• ${item.label} — ${item.note}`).join("\n")}\nYou can send them here. The new file replaces the previous one.`,
      askEscalate: "Would you like me to pass this to a consultant, or try again in a bit?",
      cooldownWait: (minutes) => `You can try again in about ${minutes} minutes.`,
      escalateAccepted: "I'll pass this to a consultant. They'll get back to you soon.",
      escalateDeclined: "No problem. You can try again after the wait, or send a different file.",
      escalated: "A consultant will review this and get back to you.",
      uploadFailed: "I've received the file, but it hasn't reached the office system yet. I'll try again with your next message.",
      reasons: {
        field_present: "a required detail is missing",
        id_number: "I couldn't read the ID number. Please send a clearer photo of the card, with the name and number visible",
        matches_profile: "its details don't match the file we have",
        date_within_months: "the date on it is too old",
        prior_calendar_months: "it doesn't cover the three previous months",
        min_items: "some required items are missing",
        wrong_type: "this isn't one of the documents currently needed",
        unrecognized: "I couldn't tell what this file is",
        unreadable: "I couldn't read the file",
        no_model: "I couldn't read the file",
        extract_failed: "I couldn't read the file",
        too_large: "the file is too large",
        unsupported_type: `send a ${supportedTypeLabels("or")}`,
      },
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
    `Front-desk chat: answer from knowledge first with the reply tool. Booking is available when they ask to schedule. Collect booking details only after they ask: ${fields}. Never say the visit is confirmed - book_meeting only stores a tentative request.`,
  catalogBook: (fields) =>
    `You help people learn about the business and book a visit when ready. Be warm. You are not the specialist. Answer product questions from knowledge before collecting booking fields. Only after they explicitly want to schedule, collect: ${fields}. Never confirm a slot - book_meeting only stores a tentative request. Confirm details before book_meeting.`,
  catalogFaq:
    "You answer simple questions from the intro and knowledge. Do not collect booking details or offer meetings.",
  talkGuardrails: ({ allowBook, hours, whatsappPhone, bookingStance }) => {
    const hoursLine = hours
      ? `Opening hours (for context only): ${hours}. When asking for a day/time, phrase hours in natural language - never paste this string verbatim as the message.`
      : "If opening hours are in context, phrase them naturally when asking for a day/time - never dump a raw hours string.";
    const phoneLine = whatsappPhone
      ? `A callback number can be deduced for this chat: ${whatsappPhone}. If phone is required and not yet saved, confirm that number (or accept a different one). When they confirm, save_fields with phone=${whatsappPhone}.`
      : "If phone is required and not saved, ask for a callback number via ask_field or reply.";
    const scheduling = !allowBook
      ? "Do not offer or book meetings."
      : bookingStance === "proactive"
        ? "Suggest a meeting at most once, only after the knowledge answer and only when the file did not already specify the next step. Do not ask for a day or time until they accept. Call start_booking only when they ask for a meeting, visit, or call, or accept that offer."
        : "Do not ask for a day or time on product interest. Offer a meeting at most once, only after the knowledge answer and only when the file did not already specify the next step. Call start_booking only when they ask for a meeting, visit, or call, or accept that offer.";
    return [
      "BOUNDARIES (always apply, override persona and earlier stage instructions; do not override a knowledge instruction):",
      "If the knowledge file tells you what to reply, which link to send, or which workflow to use for this kind of message, do that. Do not replace that instruction with another capability's flow.",
      "MAY: greet; answer hours, address, phone, email, service area, and listed offerings from knowledge; save details they already said; ask at most one clarifying question.",
      phoneLine,
      hoursLine,
      "MUST NOT: jump to day/time questions on product interest; speak as a professional; invent capabilities, prices, or warranty terms missing from knowledge; tell them the slot is confirmed; invent a phone number, a callback, or a calendar link.",
      "A phone or URL may appear only when that exact string is in knowledge. Do not offer to send it later. Do not offer a phone number from context.",
      "If knowledge does not answer their question: say so in one clause, and do not invent a phone number or a link.",
      "Do not call request_human just because they showed sales interest - answer first.",
      scheduling,
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
Do not invent facts that are not grounded in the text. Omit name/phone/address/hours if they are not clearly present.
- name: official business name
- phone: public customer-facing phone
- intro: ALWAYS provide 1–3 sentences the agent should say as this business on the first customer message (same language as the document). If the document already has a greeting/self-introduction, use it (lightly cleaned). If it does not, write a warm, natural greeting from the business name and what they do - do not leave intro empty when there is enough context to greet.
- venueAddress: street address customers visit, if any
- venueHours: opening hours as a short phrase operators can edit (e.g. "Sun–Thu 09:00–19:00" or "א', ג', ה' 09:00-19:00 | ב', ד' 09:00-15:00 | שישי 09:00-13:00"). Prefer day lists + clock ranges so they can be checked precisely.
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
      `Opening hours (phrase naturally when relevant - never paste verbatim as a message): ${hours || "(none)"}`,
      `Known lead fields: ${fieldsJson}`,
      channelLine,
      "Default action: call reply with a helpful answer from knowledge/intro. Do not start booking on product interest alone.",
      `Booking is available later. Required fields when booking starts: ${requiredFields}.`,
      "Contact fields are for the visit request. They do not mean the visit is confirmed.",
      "Save names in the customer's original wording. Do not translate names.",
      "Never treat the channel profile/display name as the booking name - ask them how they are called.",
      `Always refer to the business as "${business}" - never invent a company name from the customer's name (e.g. do not turn "Dana" into "Dana AI").`,
      "Continue the topic. Never repeat the intro or your last message.",
      "Never say the appointment is confirmed. book_meeting only records a tentative request for the owner.",
      "Always call reply once with the user-facing text and intent (sales / support / other), unless ask_field already set the outbound text.",
      `Latest customer message: ${last}`,
    ].join("\n"),
  nudgeDefaultInstruction:
    "Send a brief friendly follow-up because they have not replied. Continue the same thread; do not repeat the full intro or copy your last message verbatim.",
  nudgeTurn: (instruction) =>
    [
      "MODE: silence nudge (follow-up only).",
      "You are the BUSINESS assistant speaking TO the customer on WhatsApp - never the customer.",
      "The customer (lead) has not replied for a while. Write ONE short outbound message the business sends next.",
      "Continue the open thread from the business side: pick up the last topic or gently re-ask what you were waiting on.",
      "Do NOT impersonate the customer, do NOT answer on their behalf, do NOT write what they might say.",
      "Do NOT prefix with role labels (no 'agent:', 'lead:', 'customer:', 'business:'). Output plain message text only.",
      "Do NOT start a new welcome, do NOT call tools, do NOT confirm visits, do NOT escalate.",
      "Do NOT say a visit or meeting was saved, submitted, or scheduled.",
      "Do NOT offer a calendar link, a callback, or a phone number, and do not attach a link. A phone or URL may appear only when that exact string is in knowledge.",
      "If booking is in progress, re-ask the open question you were waiting on.",
      "Match the customer's language from their latest message.",
      `Operator guidance: ${instruction}`,
    ].join("\n"),
};
