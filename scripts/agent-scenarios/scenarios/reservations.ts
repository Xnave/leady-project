import type { Scenario } from "@/lib/scenarios/types";
import { RESERVATION_SESSION_FIELD_KEYS } from "@/lib/flow/reservation-config";

const stay = ["היי, אשמח להזמין מיום חמישי עד יום ראשון ל-5 אנשים", "דנה כהן", "0501234567"];

const held: Scenario["expect"] = {
  request: "pending",
  hitlOpen: true,
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

export const reservationScenarios: Scenario[] = [
  {
    id: "reservation-happy-approve-reopen",
    suite: "smoke",
    capability: "reservations",
    review: "בדקי ניסוח, מגדר הסוכנת, ושתודה לא פותחת הזמנה חדשה.",
    expect: held,
    decide: approved,
    followUp: {
      turns: ["תודה רבה, זה הכל"],
      expect: {
        request: "approved",
        crmPresent: ["name", "phone"],
        sessionAbsent: [...RESERVATION_SESSION_FIELD_KEYS],
      },
      review: "אחרי האישור השם והטלפון נשארים. תאריכים, אורחים ויחידה לא אמורים להישאר.",
    },
    variants: [
      { id: "thu-sun", primary: true, turns: stay },
      {
        id: "couple-and-child",
        sample: true,
        turns: [
          "אפשר מיום שני עד יום רביעי בשבוע הבא? אנחנו זוג ועוד ילד, ואני לא בטוחה אם צריך עוד משהו",
          "דנה כהן",
          "0501234567",
        ],
        review: "אותה הזמנה. הלקוחה אמרה שהיא לא בטוחה, אז הפנייה אליה צריכה להיות בלשון נקבה.",
      },
    ],
  },
  {
    id: "reservation-bad-range",
    suite: "smoke",
    capability: "reservations",
    review: "תאריך יציאה לפני תאריך כניסה. לא נוצרת הזמנה.",
    expect: { request: "none" },
    variants: [
      {
        id: "checkout-first",
        primary: true,
        turns: ["אשמח להזמין מ-10 במרץ עד 8 במרץ", "שני אורחים, קוראים לי דנה כהן"],
      },
    ],
  },
  {
    id: "reservation-not-a-stay",
    suite: "full",
    capability: "reservations",
    review: "שאלת מחיר. לא נפתחת הזמנה ולא נפתחת משימת אישור.",
    expect: { request: "none", hitlOpen: false },
    variants: [{ id: "price", primary: true, turns: ["שלום, מה המחיר ללילה?"] }],
  },
  {
    id: "reservation-fresh-thread",
    suite: "smoke",
    capability: "reservations",
    review: "אחרי סגירה יזומה נפתחת שיחה חדשה. השם נשאר, תאריכי השהייה לא.",
    expect: held,
    decide: approved,
    endThen: {
      turns: ["היי, אני רוצה להזמין שוב"],
      expect: {
        freshConversation: true,
        crmPresent: ["name"],
        sessionAbsent: ["check_in", "check_out", "guests", "unit"],
      },
      review: "שיחה חדשה. לא אמורה כבר להכיר את התאריכים או את מספר האורחים מההזמנה שאושרה.",
    },
    variants: [{ id: "thu-sun", primary: true, turns: stay }],
  },
];
