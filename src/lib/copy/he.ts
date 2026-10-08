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
  askName: "נעים להכיר — איך קוראים לך במלא, כדי שנוכל לרשום את הפגישה?",
  askEmail: "לאן לשלוח את אישור הפגישה? אפשר לכתוב כאן אימייל.",
  askPhone: "מה מספר הטלפון הכי נוח לחזרה אלייך?",
  askPhoneConfirm: (phone) =>
    `אשמח לוודא — לחזרה אשתמש במספר ${phone}. מתאים, או לשלוח מספר אחר?`,
  askPhoneAgain: "עדיין חסר לי מספר לחזרה כדי לקלוט את בקשת הביקור. אפשר לשלוח מספר?",
  askFieldAgain: (field) => `עדיין חסר לי ${field} כדי לשלוח את בקשת הביקור.`,
  waitingHumanHold: "קיבלנו, נציג חוזר אליך.",
  askNeed: "אשמח להכין את הפגישה כמו שצריך — מה חשוב שנדע עליך או על מה שתרצו לראות?",
  askNeedWithGathered: (gathered) =>
    [
      "מעולה, ככה הבנתי עד עכשיו מהשיחה:",
      gathered,
      "",
      "יש משהו נוסף שכדאי שנוסיף לקראת הפגישה? אפשר להוסיף פרטים, או לכתוב שזה מספיק.",
    ].join("\n"),
  bookingConfirmIntro: "מעולה, הנה פרטי הפגישה שרשמתי:",
  bookingConfirmAsk: "האם הפרטים נכונים ואפשר לשמור את הבקשה?",
  askVisitKind: "איזה סוג ביקור מתאים לך?",
  askTime: (hours) =>
    hours
      ? `אנחנו זמינים ${hours}. מתי יהיה לך נוח להיפגש — יום ושעה?`
      : "מתי יהיה לך נוח להיפגש — יום ושעה?",
  askFieldFallback: (field) => `חסר לי עוד פרט לפגישה: ${field}.`,
  askFieldWithOptions: (field, options) => `איזה ${field} מתאים לך? אפשרויות: ${options}`,
  availability: (hours) =>
    hours
      ? `אנחנו זמינים ${hours}. מתי יהיה לך נוח להיפגש — יום ושעה?`
      : "מתי יהיה לך נוח להיפגש — יום ושעה?",
  hoursLine: (hours) => `שעות פתיחה: ${hours}`,
  askTimeOutsideHours: (hours) =>
    hours
      ? `השעה שבחרת מחוץ לשעות הפעילות (${hours}). באיזה יום ושעה אחרים נוח לך?`
      : "השעה שבחרת מחוץ לשעות הפעילות שלנו. באיזה יום ושעה אחרים נוח לך?",
  askTimeAmbiguous: "התכוונת לבוקר או לערב? כתוב בבקשה שעה ברורה (למשל 6 בערב או 18:00).",
  askTimeUnclear: "באיזה יום ובאיזו שעה בדיוק נוח לך? כתוב גם את השעה במספרים.",
  askTimeInvalidHours: "לא הצלחתי לבדוק את שעות הפעילות כרגע. באיזה יום ושעה אחרים נוח לך?",
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
  request: {
    askField: (label) => `מה ה${label} שלך?`,
    confirmTitle: (noun) => `פרטי ה${noun}:`,
    confirmAsk: "האם הפרטים נכונים?",
    needValidDates:
      "צריך תאריך התחלה וסיום תקינים (סיום אחרי התחלה) לפני בדיקת זמינות.",
    invalidDates: "תאריכי ההתחלה/סיום לא תקינים.",
    stillNeed: (gaps) => `עדיין חסר: ${gaps}`,
    availabilityNotConfigured:
      "לא ניתן לבדוק זמינות אוטומטית — נעביר לנציג או נשלח קישור להזמנה.",
    datesUnavailable: (url) =>
      url
        ? `התאריכים תפוסים. אפשר לבדוק תאריכים אחרים או לפתוח: ${url}`
        : "התאריכים תפוסים.",
    datesAvailable: "התאריכים פנויים לפי היומן המקוון.",
    availabilityUnknownLink: (url) =>
      `לא הצלחתי לאשר זמינות בוודאות. אפשר לבדוק ולהזמין כאן: ${url}`,
    availabilityUnknownHitl: "לא הצלחתי לאשר זמינות בוודאות — אעביר לנציג לאישור.",
    defaultRequest: ({ noun, from, to, details }) =>
      `רשמתי בקשת ${noun} מ-${from} עד ${to}${details ? ` · ${details}` : ""}. נציג יאשר או יציע תאריכים אחרים.`,
    defaultApproved: (noun, from, to) =>
      `ה${noun} אושר ל-${from} עד ${to}. נשמח לראותכם.`,
    defaultRejected: (noun, from, to, note) =>
      `לצערנו לא הצלחנו לאשר ${noun} בתאריכים ${from}–${to}.${note ? ` ${note}` : ""}`,
    completeBookingLink: (url) => `לסיום ההזמנה: ${url}`,
    sendBookingLink: (noun, url) => `מעולה — אפשר להשלים את ה${noun} כאן: ${url}`,
    offerAltDates: (from, to) =>
      `התאריכים המבוקשים לא זמינים. האם ${from} עד ${to} מתאים?`,
    offerDeclineAsk: "אין בעיה — איזה תאריכים אחרים מתאימים לך?",
    offerUnclearAsk: "רק לוודא — האם התאריכים שהוצעו מתאימים?",
  },
};

/** System prompts stay in English so the model follows tools reliably. */
export const prompts: PromptCopy = {
  ...enPrompts,
  languageRule: "Reply only in Hebrew. Never mix in English filler.",
};
