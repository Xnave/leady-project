import type { Persona } from "@/lib/persona/types";

export type Scenario = {
  id: string;
  lang: "en" | "he";
  customer: string[];
  expect: string;
  /** Owner's "הצגה עצמית" for this scenario (default: the fixture's, which doesn't introduce the agent). */
  intro?: (p: Persona) => string;
};

/** An owner opening that already introduces the agent, with the persona's own name. */
const selfIntro = {
  he: (p: Persona) =>
    `היי! ${p.agentName ? `אני ${p.agentName}, ` : "כאן "}${p.gender === "male" ? "העוזר הדיגיטלי" : "העוזרת הדיגיטלית"} של מטבחי הזהב. איך אפשר לעזור לתכנן את המטבח שלכם?`,
  en: (p: Persona) =>
    `Hi! ${p.agentName ? `I'm ${p.agentName}, ` : "This is "}Golden Kitchens' digital assistant. How can I help you plan your kitchen?`,
};

export const SCENARIOS: Scenario[] = [
  { id: "he-price", lang: "he", customer: ["היי, כמה עולה מטבח?"], expect: "No invented price; explains it depends; offers a next step." },
  { id: "he-vague", lang: "he", customer: ["היי", "מתעניינת"], expect: "Warm, asks one useful question; no booking push." },
  { id: "he-book", lang: "he", customer: ["אפשר לקבוע פגישה באולם התצוגה?", "יום שלישי בבוקר", "דנה כהן"], expect: "Starts booking, collects fields one at a time, never says confirmed." },
  { id: "he-interest-not-book", lang: "he", customer: ["אתם עושים גם מטבחים כפריים?"], expect: "Answers from knowledge; does NOT start collecting booking details." },
  { id: "he-complaint", lang: "he", customer: ["הדלת של הארון התפרקה אחרי חודשיים, אני ממש עצבני"], expect: "Empathy first, mentions warranty, offers human/phone." },
  { id: "he-out-of-scope", lang: "he", customer: ["אתם מתקינים גם מזגנים?"], expect: "Says no briefly, offers what they do." },
  { id: "he-female-customer", lang: "he", customer: ["אני רוצה לשפץ את המטבח, אני לא בטוחה מאיפה להתחיל"], expect: "Addresses the customer in feminine after she reveals it." },
  { id: "he-one-word", lang: "he", customer: ["מחיר?"], expect: "Short, helpful, one question." },
  { id: "he-area", lang: "he", customer: ["אתם מגיעים לחיפה?"], expect: "Says honestly they don't serve Haifa." },
  { id: "he-warranty", lang: "he", customer: ["מה האחריות?"], expect: "10 years cabinets, 2 years hardware; nothing invented." },
  { id: "en-price", lang: "en", customer: ["How much for a kitchen?"], expect: "No invented price; next step." },
  { id: "en-vague", lang: "en", customer: ["hey", "interested"], expect: "Warm, one question." },
  { id: "en-book", lang: "en", customer: ["Can I book a showroom visit?", "Thursday afternoon", "Mike Levi"], expect: "Collects fields, never confirms." },
  { id: "en-complaint", lang: "en", customer: ["Nobody called me back for a week. Really disappointed."], expect: "Empathy, ownership, concrete next step." },
  { id: "en-hours", lang: "en", customer: ["are you open friday?"], expect: "Natural-language hours, not a pasted string." },
  // Repetition: the owner's opening already introduces the agent.
  {
    id: "he-own-intro-question-first",
    lang: "he",
    intro: selfIntro.he,
    customer: ["היי, כמה עולה מטבח?"],
    expect: "Introduces itself once (from the owner's opening), answers the question, doesn't ask how it can help.",
  },
  {
    id: "he-own-intro-hello-then-question",
    lang: "he",
    intro: selfIntro.he,
    customer: ["היי", "כמה זמן לוקח להתקין מטבח?"],
    expect: "First reply is the owner's opening; the second answers without greeting or introducing itself again.",
  },
  {
    id: "he-hello-then-question",
    lang: "he",
    customer: ["שלום", "יש לכם אולם תצוגה?"],
    expect: "Second reply answers without greeting or introducing itself again.",
  },
  {
    id: "en-own-intro-question-first",
    lang: "en",
    intro: selfIntro.en,
    customer: ["Hi! How much is a kitchen?"],
    expect: "Introduces itself once, answers the question, doesn't ask how it can help.",
  },
];
