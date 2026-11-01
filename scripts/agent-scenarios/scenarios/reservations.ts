import type { Scenario } from "@/lib/scenarios/types";
import { RESERVATION_SESSION_FIELD_KEYS } from "@/lib/flow/reservation-config";

export const stayTurns = [
  "היי, אשמח להזמין מיום חמישי עד יום ראשון ל-5 אנשים",
  "דנה כהן",
  "0501234567",
  "הוילה הראשית",
];

const held: Scenario["expect"] = {
  request: "pending",
  hitlOpen: true,
};

/** Friday 13 Nov 2026 through Sunday 15 Nov. Staff offers this after the Thursday stay is pending. */
const STAFF_OFFER = {
  alternativeStart: "2026-11-13",
  alternativeEnd: "2026-11-15",
};

function staffOfferScenarios(turns: string[]): Scenario[] {
  const offered: Scenario["decide"] = {
    decision: "reschedule",
    alternativeStart: STAFF_OFFER.alternativeStart,
    alternativeEnd: STAFF_OFFER.alternativeEnd,
    then: {
      request: "pending",
      hitlOpen: true,
      requestStartsOn: "friday",
      conversationStatus: "open",
      sessionPresent: ["staff_date_offer"],
      replyIncludes: [STAFF_OFFER.alternativeStart, STAFF_OFFER.alternativeEnd],
    },
  };
  const shared = {
    suite: "extra" as const,
    capability: "reservations" as const,
    expect: held,
    decide: offered,
    variants: [{ id: "thu-sun", primary: true, turns }],
  };
  return [
    {
      ...shared,
      id: "reservation-offer-accept",
      review: "הנציג מציע שישי עד ראשון. הלקוחה מסכימה, וההזמנה מאושרת על התאריכים האלה.",
      followUp: {
        turns: ["כן, התאריכים שהצעתם מתאימים"],
        expect: {
          request: "approved",
          requestStartsOn: "friday",
          hitlOpen: false,
          conversationStatus: "closed",
          sessionAbsent: ["staff_date_offer"],
          crmPresent: ["name", "phone"],
        },
        review: "ההסכמה סוגרת את השיחה על התאריכים שהוצעו. השם והטלפון נשארים.",
      },
    },
    {
      ...shared,
      id: "reservation-offer-decline",
      review: "הנציג מציע שישי עד ראשון. הלקוחה מסרבת בלי לבקש תאריך אחר.",
      followUp: {
        turns: ["לא תודה, זה לא מתאים לי"],
        expect: {
          request: "pending",
          requestNot: "approved",
          hitlOpen: true,
          conversationStatus: "open",
          sessionAbsent: ["staff_date_offer"],
          replyIncludes: ["תאריכים אחרים"],
        },
        review: "הסירוב לא מאשר את ההצעה. הסוכנת שואלת אילו תאריכים כן מתאימים.",
      },
    },
    {
      ...shared,
      id: "reservation-offer-other-dates",
      review: "הנציג מציע שישי עד ראשון. הלקוחה מבקשת שני עד רביעי במקום.",
      followUp: {
        turns: ["לא, התאריכים שהצעתם לא מתאימים. אפשר מיום שני עד יום רביעי?"],
        expect: {
          request: "pending",
          requestStartsOn: "monday",
          requestNot: "approved",
          hitlOpen: true,
          conversationStatus: "open",
          sessionAbsent: ["staff_date_offer"],
        },
        review: "הבקשה נשארת ממתינה, אבל על שני עד רביעי ולא על ההצעה.",
      },
    },
  ];
}

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
      { id: "thu-sun", primary: true, turns: stayTurns },
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
    variants: [{ id: "thu-sun", primary: true, turns: stayTurns }],
  },
  {
    id: "reservation-declined",
    suite: "extra",
    capability: "reservations",
    review: "ההזמנה נאספת ואז נדחית. לא נשארת משימת אישור.",
    expect: held,
    decide: {
      decision: "decline",
      then: {
        request: "rejected",
        hitlOpen: false,
        conversationStatus: "open",
      },
    },
    followUp: {
      turns: ["תודה רבה, זה הכל"],
      expect: {
        request: "rejected",
        requestNot: "pending",
        hitlOpen: false,
        crmPresent: ["name", "phone"],
      },
      review: "אחרי הסירוב תודה לא פותחת הזמנה חדשה. השם והטלפון נשארים.",
    },
    variants: [{ id: "thu-sun", primary: true, turns: stayTurns }],
  },
  {
    id: "reservation-change-dates",
    suite: "extra",
    capability: "reservations",
    review: "הלקוחה מתקנת מחמישי לשישי. ההזמנה נשמרת על יום שישי, לא על היום הראשון.",
    expect: {
      request: "pending",
      hitlOpen: true,
      requestStartsOn: "friday",
    },
    variants: [
      {
        id: "fri-sun",
        primary: true,
        turns: [
          "היי, אשמח להזמין מיום חמישי עד יום ראשון ל-5 אנשים",
          "בעצם לא חמישי, מיום שישי עד יום ראשון",
          "דנה כהן",
          "0501234567",
          "הוילה הראשית",
        ],
      },
    ],
  },
  ...staffOfferScenarios(stayTurns),
];
