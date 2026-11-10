import type { Scenario } from "@/lib/scenarios/types";
import { RESERVATION_SESSION_FIELD_KEYS } from "@/lib/flow/reservation-config";
import { stayTurns } from "./reservations";

/**
 * וילה ג'ספר finishes by sending a booking link. No Request and no approval task.
 * The 2026-10-29 18:13 run is the shape: name, phone, unit, then the link.
 * Not part of the default smoke run. `npm run scenarios -- --suite link`.
 */
const sent: Scenario["expect"] = {
  request: "none",
  hitlOpen: false,
  replyIncludes: ["http"],
};

const cleared = [...RESERVATION_SESSION_FIELD_KEYS];

export const reservationLinkScenarios: Scenario[] = [
  {
    id: "reservation-link-stay",
    suite: "link",
    capability: "reservations",
    pool: "link",
    cadenceDays: 7,
    review: "אחרי היחידה נשלח קישור להזמנה. לא נפתחת בקשה ולא נפתחת משימת אישור.",
    expect: sent,
    followUp: {
      turns: ["תודה רבה, זה הכל"],
      expect: {
        request: "none",
        hitlOpen: false,
        crmPresent: ["name", "phone"],
        sessionAbsent: cleared,
        replyAvoids: ["http"],
      },
      review: "תודה לא שולחת קישור נוסף ולא פותחת שהייה חדשה. השם והטלפון נשארים.",
    },
    variants: [{ id: "thu-sun", primary: true, turns: stayTurns }],
  },
  {
    id: "reservation-link-fresh-thread",
    suite: "link",
    capability: "reservations",
    pool: "link",
    cadenceDays: 7,
    review: "אחרי הקישור סוגרים את השיחה. שיחה חדשה לא מכירה את התאריכים.",
    expect: sent,
    endThen: {
      turns: ["היי, אני רוצה להזמין שוב"],
      expect: {
        request: "none",
        freshConversation: true,
        crmPresent: ["name"],
        sessionAbsent: ["check_in", "check_out", "guests", "unit"],
        replyAvoids: ["http"],
      },
      review: "שיחה חדשה. לא אמורה כבר להכיר את התאריכים או לשלוח את הקישור הישן.",
    },
    variants: [{ id: "thu-sun", primary: true, turns: stayTurns }],
  },
];
