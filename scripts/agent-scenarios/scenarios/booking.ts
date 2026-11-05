import type { Scenario } from "@/lib/scenarios/types";

const visitDetails = ["היי, אפשר לקבוע ביקור מחר ב-10?", "דנה כהן", "פגישת ייעוץ", "0501234567"];
const visit = [...visitDetails, "כן"];

/** Visit state that should be gone once the thread is approved. The name flag stays with the lead. */
const clearedVisit = ["booking_flow", "booking_confirm", "booking", "time_preference", "need", "visit_kind"];

/** The script answers these only after the agent has asked for them. */
const askedForVisit: NonNullable<Scenario["expect"]["agentAskedBefore"]> = [
  { customerIncludes: "דנה כהן", anyOf: ["שמך", "השם"] },
  { customerIncludes: "פגישת ייעוץ", anyOf: ["פרטי הפגישה", "מה חשוב לך"] },
  { customerIncludes: "0501234567", anyOf: ["טלפון"] },
];

const booked: Scenario["expect"] = {
  request: "pending",
  hitlOpen: true,
  sessionPresent: ["time_preference"],
  agentAskedBefore: askedForVisit,
};

/** A valid time was given. Asking for a day and time again means it was ignored. */
const timeKept: Scenario["expect"] = {
  requestNot: "approved",
  sessionPresent: ["time_preference"],
  replyAvoids: ["איזה יום ושעה", "מתי נוח", "איזו שעה"],
};

const approved: Scenario["decide"] = {
  decision: "approve",
  then: {
    request: "approved",
    hitlOpen: false,
    conversationStatus: "closed",
    sessionEmpty: true,
    crmPresent: ["name", "phone"],
  },
};

export const bookingScenarios: Scenario[] = [
  {
    id: "booking-happy-approve-reopen",
    suite: "smoke",
    capability: "booking",
    review: "בדקי שהשיחה זורמת, שהפנייה תואמת את מגדר הסוכנת, ושתודה לא פותחת ביקור חדש.",
    expect: booked,
    decide: approved,
    followUp: {
      turns: ["תודה רבה, זה הכל"],
      expect: {
        request: "approved",
        crmPresent: ["name", "phone"],
        sessionAbsent: clearedVisit,
      },
      review: "אחרי האישור השם והטלפון נשארים. שעת הביקור והצורך לא אמורים להישאר בשיחה.",
    },
    variants: [
      { id: "tomorrow-10", primary: true, turns: visit },
      {
        id: "tuesday-morning",
        sample: true,
        turns: ["אפשר ביקור ביום שלישי בבוקר", "דנה כהן", "פגישת ייעוץ", "0501234567", "כן"],
        review: "אותה הזמנה, ניסוח אחר של השעה. הבקשה עדיין צריכה להיווצר.",
      },
    ],
  },
  {
    id: "booking-bad-time",
    suite: "smoke",
    capability: "booking",
    review: "שעה בלתי אפשרית, ואז תיקון לשעה תקינה. התיקון נשמר, ואין לשאול שוב איזה יום ושעה.",
    expect: timeKept,
    variants: [
      {
        id: "hour-25",
        primary: true,
        turns: ["אפשר לקבוע ביקור ב-25:00", "סליחה, התכוונתי למחר ב-10"],
      },
      {
        id: "yesterday",
        sample: true,
        turns: ["אפשר ביקור אתמול ב-10", "בעצם מחר ב-10"],
        review: "אותו תיקון של שעה לא תקינה, עם יום שעבר במקום שעה שלא קיימת.",
      },
    ],
  },
  {
    id: "booking-closed-day",
    suite: "smoke",
    capability: "booking",
    review: "יום סגור, ואז תיקון ליום פתוח. התיקון נשמר, ואין לשאול שוב איזה יום ושעה.",
    expect: timeKept,
    variants: [
      {
        id: "saturday-then-tomorrow",
        primary: true,
        turns: ["אפשר ביקור בשבת ב-10", "בעצם מחר ב-10"],
      },
    ],
  },
  {
    id: "booking-decline",
    suite: "smoke",
    capability: "booking",
    review: "אחרי שהפרטים נאספו הלקוחה אומרת לא. לא נפתחת בקשה ולא נפתחת משימת אישור.",
    expect: { request: "none", hitlOpen: false, agentAskedBefore: askedForVisit },
    variants: [{ id: "no", primary: true, turns: [...visitDetails, "לא"] }],
  },
  {
    id: "booking-not-a-booking",
    suite: "full",
    capability: "booking",
    review: "שאלה על העסק. לא נפתחת בקשה ולא נפתחת משימת אישור.",
    expect: { request: "none", hitlOpen: false },
    variants: [{ id: "hours-and-price", primary: true, turns: ["שלום, מה שעות הפעילות?", "וכמה זה עולה?"] }],
  },
  {
    id: "booking-yes-too-early",
    suite: "smoke",
    capability: "booking",
    review: "אישור לפני שנאסף משהו. לא נוצרת בקשה.",
    expect: { request: "none" },
    variants: [{ id: "yes", primary: true, turns: ["כן, תסגרי לי את זה"] }],
  },
  {
    id: "booking-nonsense",
    suite: "smoke",
    capability: "booking",
    review: "קלט לא קשור לביקור. לא נפתחת בקשה, והתשובה לא מתיימרת שקבענו.",
    expect: { request: "none", hitlOpen: false },
    variants: [{ id: "gibberish", primary: true, turns: ["קשקוש בלה בלה"] }],
  },
  {
    id: "booking-handoff",
    suite: "full",
    capability: "booking",
    review: "תלונה ובקשה לבן אדם. עוברת לאדם, בלי בקשת ביקור.",
    expect: { request: "none", handoff: true },
    variants: [
      {
        id: "person",
        primary: true,
        turns: ["המתקין לא הגיע בפעם השלישית. אני רוצה לדבר עם בן אדם"],
      },
    ],
  },
  {
    id: "booking-fresh-thread",
    suite: "smoke",
    capability: "booking",
    review: "אחרי סגירה יזומה נפתחת שיחה חדשה. השם נשאר, פרטי הביקור הקודם לא.",
    expect: booked,
    decide: approved,
    endThen: {
      turns: ["היי, אני רוצה לקבוע ביקור חדש"],
      expect: {
        freshConversation: true,
        crmPresent: ["name"],
        sessionAbsent: ["time_preference", "need", "visit_kind"],
      },
      review: "שיחה חדשה. לא אמורה כבר להכיר את השעה או את הצורך מהביקור שאושר.",
    },
    variants: [{ id: "tomorrow-10", primary: true, turns: visit }],
  },
];
