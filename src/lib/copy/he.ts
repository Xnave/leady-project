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
  whyCollect: "אני מבקש פרטים כדי שאוכל לעזור עם הפנייה שלך. איך אפשר לעזור לך עכשיו?",
  askName: "נעים להכיר! באיזה שם מלא לרשום את הפגישה?",
  askEmail: "לאיזו כתובת אימייל נשלח את אישור הפגישה?",
  askPhone: "באיזה מספר טלפון נוח לך שניצור קשר?",
  askPhoneConfirm: (phone) =>
    `רק לוודא — נוח לך שניצור קשר במספר ${phone}, או שעדיף מספר אחר?`,
  askPhoneAgain: "כדי שנוכל לחזור אליך לגבי הביקור, באיזה מספר טלפון נוח לך שניצור קשר?",
  askFieldAgain: (field) => `עדיין חסר לי ${field} כדי לשלוח את בקשת הביקור.`,
  waitingHumanHold: "הפנייה התקבלה, ונציג מהצוות יחזור אליך.",
  askNeed: "כדי שנוכל להתכונן לפגישה, מה חשוב לך שנדע מראש?",
  askNeedWithGathered: (gathered) =>
    [
      "תודה, הנה מה שהבנתי עד עכשיו:",
      gathered,
      "",
      "יש עוד משהו שחשוב לך שנדע לקראת הפגישה? אם לא, אפשר לכתוב שזה הכול.",
    ].join("\n"),
  bookingConfirmIntro: "הנה פרטי הפגישה, כדי שנוכל לוודא שהכול נכון:",
  bookingConfirmAsk: "הכול נכון ואפשר לשמור את הבקשה, או שיש משהו שצריך לשנות?",
  askVisitKind: "איזה סוג ביקור יתאים לך?",
  askTime: (hours) =>
    hours
      ? `אפשר להיפגש בשעות הבאות: ${hours}. איזה יום ושעה יתאימו לך?`
      : "איזה יום ושעה יתאימו לך לפגישה?",
  askFieldFallback: (field) => `כדי להתכונן לפגישה, אפשר לקבל את הפרט הבא: ${field}?`,
  askFieldWithOptions: (field, options) => `מה מתאים לך מבחינת ${field}? אפשר לבחור מבין: ${options}.`,
  availability: (hours) =>
    hours
      ? `אפשר להיפגש בשעות הבאות: ${hours}. איזה יום ושעה יתאימו לך?`
      : "איזה יום ושעה יתאימו לך לפגישה?",
  hoursLine: (hours) => `שעות פתיחה: ${hours}`,
  askTimeOutsideHours: (hours) =>
    hours
      ? `בשעה הזו אנחנו לא פעילים. שעות הפעילות שלנו הן ${hours}. איזה מועד אחר יתאים לך?`
      : "בשעה הזו אנחנו לא פעילים. איזה יום ושעה אחרים יתאימו לך?",
  askTimeAmbiguous: "רק כדי לוודא שהבנתי נכון — הכוונה לבוקר או לערב? אפשר לכתוב למשל 6 בערב או 18:00.",
  askTimeUnclear: "כדי שאוכל לרשום את המועד נכון, אפשר לציין יום ושעה? למשל, יום שלישי ב־14:00.",
  askTimeInvalidHours: "כרגע לא הצלחתי לבדוק את שעות הפעילות. איזה מועד נוסף יכול להתאים לך?",
  bookingRequestTemplate:
    "רשמתי בקשה לפגישה ב־{{date}} בשעה {{time}}. נציג מ{{business}} יאשר את הבקשה בקרוב.",
  bookingApprovedTemplate:
    "הפגישה אושרה ליום {{weekday}} בשעה {{time}} בתאריך {{date}}.",
  bookingRejected:
    "לצערנו לא הצלחנו לאשר את הפגישה ב־{{slot}} עבור {{name}}. בקשת הפגישה למועד הזה בוטלה. איזה יום ושעה אחרים יכולים להתאים לך? {{hours}}.",
  bookingReschedule:
    "לצערנו לא הצלחנו לאשר את הפגישה ב־{{slot}} עבור {{name}}. בקשת הפגישה למועד הזה בוטלה. אפשר להציע במקום זאת את {{alt_slot}}. המועד הזה יתאים לך? {{hours}}.",
  notePrefix: "הערת הנציג:",
  request: {
    askField: (label) => `אפשר לקבל את הפרט הבא: ${label}?`,
    confirmTitle: (noun) => `הנה הפרטים עבור ${noun}:`,
    confirmAsk: "הכול נכון, או שיש משהו שצריך לשנות?",
    needValidDates:
      "כדי לבדוק זמינות, אפשר לציין תאריך התחלה ותאריך סיום? תאריך הסיום צריך להיות אחרי תאריך ההתחלה.",
    invalidDates: "נראה שיש אי־התאמה בתאריכים. אפשר לבדוק שוב את תאריך ההתחלה והסיום?",
    stillNeed: (gaps) => `כדי שנוכל להתקדם, אפשר להשלים את הפרטים הבאים? ${gaps}`,
    availabilityNotConfigured:
      "כרגע אין אפשרות לבדוק זמינות אוטומטית. נעביר את הבקשה לנציג או נשלח קישור להזמנה.",
    datesUnavailable: (url) =>
      url
        ? `התאריכים האלה כבר תפוסים. אילו תאריכים נוספים יכולים להתאים לך? אפשר גם לבדוק כאן: ${url}`
        : "התאריכים האלה כבר תפוסים. אילו תאריכים נוספים יכולים להתאים לך?",
    datesAvailable: "התאריכים פנויים לפי היומן המקוון.",
    availabilityUnknownLink: (url) =>
      `לא הצלחתי לאשר זמינות בוודאות. אפשר לבדוק ולהזמין כאן: ${url}`,
    availabilityUnknownHitl: "לא הצלחתי לוודא שהתאריכים פנויים. אעביר את הבקשה לנציג לבדיקה ולאישור.",
    defaultRequest: ({ noun, from, to, details }) =>
      `רשמתי בקשת ${noun} מ-${from} עד ${to}${details ? ` · ${details}` : ""}. נציג יאשר או יציע תאריכים אחרים.`,
    defaultApproved: (noun, from, to) =>
      `הבקשה עבור ${noun} אושרה לתאריכים ${from} עד ${to}. נשמח לראות אותך.`,
    defaultRejected: (noun, from, to, note) =>
      `לצערנו לא הצלחנו לאשר ${noun} בתאריכים ${from}–${to}.${note ? ` ${note}` : ""}`,
    completeBookingLink: (url) => `לסיום ההזמנה: ${url}`,
    sendBookingLink: (noun, url) => `אפשר להשלים את הבקשה עבור ${noun} כאן: ${url}`,
    offerAltDates: (from, to) =>
      `התאריכים שביקשת לא פנויים, אבל אפשר להציע את ${from} עד ${to}. זה יכול להתאים לך?`,
    offerDeclineAsk: "אין בעיה. אילו תאריכים אחרים יהיו נוחים לך?",
    offerUnclearAsk: "רק לוודא שהבנתי — התאריכים שהצענו מתאימים לך, או שנחפש אפשרות אחרת?",
  },
};

/** System prompts stay in English so the model follows tools reliably. */
export const prompts: PromptCopy = {
  ...enPrompts,
  languageRule: "Reply only in Hebrew. Never mix in English filler.",
};
