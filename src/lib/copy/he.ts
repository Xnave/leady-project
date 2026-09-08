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
  askName: "כדי לקלוט את ההזמנה במערכת — איך קוראים לך?",
  askEmail: "מה האימייל שלך לאישור הפגישה?",
  askPhone: "מה מספר הטלפון שלך לחזרה?",
  askPhoneConfirm: (phone) =>
    `אשמח לאשר — לחזרה אשתמש במספר ${phone}. זה מתאים, או לשלוח מספר אחר?`,
  askPhoneAgain: "עדיין חסר לי מספר לחזרה כדי לקלוט את בקשת הביקור. אפשר לשלוח מספר?",
  askFieldAgain: (field) => `עדיין חסר לי ${field} כדי לשלוח את בקשת הביקור.`,
  waitingHumanHold: "קיבלנו, נציג חוזר אליך.",
  askNeed: "מה חשוב שנכסה בפגישה?",
  askVisitKind: "איזה סוג ביקור מתאים לך?",
  askTime: (hours) =>
    hours ? `אנחנו פתוחים ${hours}. באיזה יום ושעה נוח לך?` : "מתי נוח לך? יום ושעה.",
  askFieldFallback: (field) => `חסר לי עוד פרט לפגישה: ${field}.`,
  availability: (hours) =>
    hours ? `אנחנו פתוחים ${hours}. באיזה יום ושעה נוח לך?` : "באיזה יום ושעה נוח לך?",
  hoursLine: (hours) => `שעות פתיחה: ${hours}`,
  bookingRequestTemplate: [
    "רשמתי בקשה לפגישה ב־{{date}} בשעה {{time}}. הצוות יאשר או יציע מועד אחר.",
    "שם: {{name}}",
    "טלפון: {{phone}}",
    "אימייל: {{email}}",
    "פרטי הפגישה: {{details}}",
    "כתובת: {{address}}",
  ].join("\n"),
  bookingApprovedTemplate:
    "הפגישה אושרה בתאריך {{date}} בשעה {{time}} עבור {{name}}, {{phone}}. פרטי הפגישה: {{details}}",
  bookingRejected: "לצערנו המועד לא אושר. מתי נוח לתאם מחדש?",
};

/** System prompts stay in English so the model follows tools reliably. */
export const prompts: PromptCopy = {
  ...enPrompts,
  languageRule: "Reply only in Hebrew. Never mix in English filler.",
};
