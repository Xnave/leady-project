import type { ChatCopy, PromptCopy } from "./types";
import { prompts as enPrompts } from "./en";

export const chat: ChatCopy = {
  fallbackTeamName: "הצוות שלנו",
  hello: (name) => `היי, כאן ${name}.`,
  helloHelp: (name) => `היי, כאן ${name}. במה אוכל לעזור?`,
  howCanIHelp: "במה אוכל לעזור?",
  howCanIHelpRe: /במה אוכל לעזור|איך אפשר לעזור/i,
  greetWithIntro: (_name, intro, askHelp) => {
    if (!askHelp) {
      return intro.replace(/\s*(במה אוכל לעזור\??|How can I help\??)\.?$/i, "").trim() || intro;
    }
    return intro;
  },
  tellMeMore: "הבנתי. ספר לי עוד קצת.",
  supportAsk: "אשמח לעזור עם התקלה. מה בדיוק קורה?",
  savingVisit: "קולט את ההזמנה במערכת.",
  faqUnresolved: "אעביר את זה למישהו מהצוות.",
  faqNoKnowledge: "אין לי תשובה במאגר הידע.",
  whyCollect: "רק אם זה עוזר לי באמת לעזור. במה אפשר לעזור עכשיו?",
  askName: "כדי לקלוט את ההזמנה במערכת - מה השם המלא שלך?",
  askEmail: "מה האימייל שלך לאישור הפגישה?",
  askPhone: "מה מספר הטלפון שלך לחזרה?",
  askPhoneConfirm: (phone) =>
    `אשמח לאשר - לחזרה אשתמש במספר ${phone}. זה מתאים, או לשלוח מספר אחר?`,
  askPhoneAgain: "עדיין חסר לי מספר לחזרה כדי לקלוט את בקשת הביקור. אפשר לשלוח מספר?",
  askFieldAgain: (field) => `עדיין חסר לי ${field} כדי לשלוח את בקשת הביקור.`,
  waitingHumanHold: "קיבלנו, נציג חוזר אליך.",
  askNeed: "ספר לי בקצרה מה חשוב שנדע לקראת הפגישה?",
  askVisitKind: "איזה סוג ביקור מתאים לך?",
  askTime: (hours) =>
    hours
      ? `שעות הפעילות שלנו: ${hours}. באיזה יום ושעה נוח לך?`
      : "באיזה יום ושעה נוח לך?",
  askFieldFallback: (field) => `חסר לי עוד פרט לפגישה: ${field}.`,
  availability: (hours) =>
    hours
      ? `שעות הפעילות שלנו: ${hours}. באיזה יום ושעה נוח לך?`
      : "באיזה יום ושעה נוח לך?",
  hoursLine: (hours) => `שעות פתיחה: ${hours}`,
  askTimeOutsideHours: (hours) =>
    hours
      ? `השעה שבחרת מחוץ לשעות הפעילות (${hours}). באיזה יום ושעה אחרים נוח לך?`
      : "השעה שבחרת מחוץ לשעות הפעילות שלנו. באיזה יום ושעה אחרים נוח לך?",
  bookingRequestTemplate: [
    "רשמתי בקשה לפגישה ב־{{date}} בשעה {{time}}. נציג מ{{business}} יאשר או יציע מועד אחר.",
    "שם: {{name}}",
    "טלפון: {{phone}}",
    "אימייל: {{email}}",
    "פרטי הפגישה: {{details}}",
    "כתובת: {{address}}",
  ].join("\n"),
  bookingApprovedTemplate: [
    "הפגישה אושרה ל־{{slot}}.",
    "שם: {{name}}",
    "טלפון: {{phone}}",
    "פרטי הפגישה: {{details}}",
  ].join("\n"),
  bookingRejected:
    "לצערנו לא הצלחנו לאשר את הפגישה ב־{{slot}} עבור {{name}}. בקשת הפגישה למועד הזה בוטלה. אפשר להציע יום ושעה אחרים? {{hours}}.",
  bookingReschedule:
    "לצערנו לא הצלחנו לאשר את הפגישה ב־{{slot}} עבור {{name}}. בקשת הפגישה למועד הזה בוטלה. מוצע מועד חלופי: {{alt_slot}}. האם זה מתאים? {{hours}}.",
  notePrefix: "הערת הנציג:",
};

/** System prompts stay in English so the model follows tools reliably. */
export const prompts: PromptCopy = {
  ...enPrompts,
  languageRule: "Reply only in Hebrew. Never mix in English filler.",
};
