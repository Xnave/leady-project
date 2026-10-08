import { bookingInstance } from "@/lib/flow/booking-config";
import { flowForCatalog } from "@/lib/flow/catalog";
import type { AgentSnapshot, TenantSnapshot } from "@/lib/flow/types";
import { defaultHitlPolicy, defaultLeadSchema } from "@/lib/flow/validate";
import type { Persona } from "@/lib/persona/types";

export const KNOWLEDGE = `מטבחי הזהב — מטבחים בהתאמה אישית מאז 2009.
- מתכננים, מייצרים ומתקינים מטבחים בבית הלקוח. סגנונות: מודרני, כפרי, קלאסי.
- אזורי שירות: תל אביב, גוש דן והשרון. לא מגיעים לחיפה ולצפון.
- אחריות: 10 שנים על ארונות, שנתיים על פרזול ומנגנונים.
- אולם תצוגה: רחוב הרוגוזין 14, אזור התעשייה חולון. אפשר לתאם ביקור.
- טלפון: 03-5551234.
- תהליך: פגישת היכרות באולם התצוגה → מדידה בבית → תכנון → ייצור (6–8 שבועות) → התקנה.
- אין מחירון קבוע: המחיר נקבע לפי מידות, חומרים וגימור, אחרי מדידה.
- לא מתקינים מזגנים, לא עושים אינסטלציה ולא חשמל.
Golden Kitchens — custom kitchens since 2009. Design, build and install at the customer's home. Service area: Tel Aviv, Gush Dan, Sharon (not Haifa/north). Warranty: 10 years on cabinets, 2 years on hardware. Showroom: 14 HaRogozin St, Holon. Phone 03-5551234. No fixed price list — price depends on size, materials and finish, quoted after measuring.`;

const HOURS = "א'-ה' 09:00-19:00, ו' 09:00-13:00";

export const fixtureTenant: TenantSnapshot = {
  name: "מטבחי הזהב",
  phone: "03-5551234",
  intro: "שלום, הגעתם למטבחי הזהב. במה אפשר לעזור?",
  chatLanguage: "multi",
  capabilityInstances: [bookingInstance({ venueHours: HOURS, venueAddress: "הרוגוזין 14, חולון" })],
};

export function fixtureAgent(persona: Persona): AgentSnapshot {
  return {
    id: "eval-agent",
    tenantId: "eval",
    catalogId: "inbox",
    systemPrompt:
      "Reply in the customer's language.\nYou represent מטבחי הזהב as a front-desk assistant only - not a professional.",
    knowledgeText: KNOWLEDGE,
    flow: flowForCatalog("inbox"),
    flowVersion: 1,
    leadSchema: defaultLeadSchema,
    hitlPolicy: defaultHitlPolicy,
    persona,
  };
}
