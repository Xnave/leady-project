/** Always injected into the talk LLM. Knowledge text cannot override this. */
export function talkGuardrails(opts: { allowBook: boolean }): string {
  const booking = opts.allowBook
    ? `GOAL: After a few facts, invite a visit. Then collect ONLY: (1) day/time, (2) name, (3) phone or email. Call book_meeting once those are known. That saves a TENTATIVE request for a human to approve — do not say the visit is confirmed. Never ask whether they need the address or extra info; the system sends the address after the request is saved.`
    : `Do not offer or book meetings.`;

  return [
    `ROLE: You are a front-desk chat assistant for this business
    You collect a few facts, answer simple questions from the knowledge text, and (if allowed) request a visit
    You are not a professional.
    The knowledge file lists what the COMPANY does. You do not perform those in this chat
    MAY:
    - Greet and answer basic facts from knowledge: hours, address, phone, email, service area, materials they sell etc.
    - Save details they already said (city, style, day/time, name, phone, user needs, details relevant for the professional to know) with save_fields.
    - Ask at most one short clarifying question if needed.`,
    opts.allowBook
      ? "- Invite to an appointment; if they want it, collect booking contact details one at a time."
      : "",
    `MUST NOT:
    - Speak as if you are a professional.
    - Assume they want a listed service unless they asked for it.
    - Ask 'do you need the address?' or 'need anything else before the visit?' — send booking details via book_meeting instead.
    - Tell them to just show up as if the slot is already confirmed.
    - Invent capabilities or prices that are not in the knowledge text.`,
    booking,
  ]
    .filter(Boolean)
    .join("\n");
}

function offeredToDoDesignInChat(reply: string): boolean {
  if (
    /לא (?:מעצב|בונה)|don't (?:design|do)|not in (?:this )?chat|לא בצ['׳]?אט/i.test(
      reply,
    )
  ) {
    return false;
  }
  const mentions3d = /תלת[-\s]?מימד|3\s*d|render|שרטוט/i.test(reply);
  const offersNow =
    /נעבור|ניצור|ליצור עבורך|we'll create|we can create|let's (?:go|move)|שלב התכנון/i.test(
      reply,
    );
  return mentions3d && offersNow;
}

/** Knowledge often lists 3D as a company service; the model must not offer it in chat. */
export function rewriteForbiddenTalkReply(
  reply: string,
  lang: "en" | "he",
): string {
  if (!offeredToDoDesignInChat(reply)) return reply;
  return lang === "he"
    ? "תודה, רשמתי את הפרטים. תכנון תלת-ממדי נעשה בפגישה עם המעצבים, לא בצ'אט. אפשר לקבוע מדידה או ביקור באולם? מתי נוח?"
    : "Thanks, I've noted that. 3D planning happens with the designers in a meeting, not in this chat. Want to book a measurement or showroom visit?";
}
