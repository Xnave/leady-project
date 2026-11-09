import { supportedTypeLabels } from "@/lib/documents/file-types";
import type { ChatCopy, PromptCopy } from "./types";
import { prompts as enPrompts } from "./en";

export const chat: ChatCopy = {
  fallbackTeamName: "הצוות שלנו",
  hello: (name) => `היי, כאן ${name}.`,
  assistantIntro: ({ agentName, business, gender }) => {
    const role = gender === "female" ? "העוזרת הדיגיטלית" : "העוזר הדיגיטלי";
    return agentName ? `היי! אני ${agentName}, ${role} של ${business}.` : `היי! כאן ${role} של ${business}.`;
  },
  askHowToHelp: "במה אפשר לעזור?",
  helloHelp: (name) => `היי, כאן ${name}. במה אוכל לעזור?`,
  howCanIHelp: "במה אוכל לעזור?",
  howCanIHelpRe: /במה אוכל לעזור|איך אפשר לעזור/i,
  greetWithIntro: (_name, intro, askHelp) => {
    if (!askHelp) {
      return intro.replace(/\s*(במה אוכל לעזור\??|How can I help\??)\.?$/i, "").trim() || intro;
    }
    return intro;
  },
  tellMeMore: "הבנתי. אפשר לספר לי עוד קצת?",
  supportAsk: "אשמח לעזור עם התקלה. מה בדיוק קורה?",
  savingVisit: "קולטים את ההזמנה במערכת.",
  faqUnresolved: "אעביר את זה למישהו מהצוות.",
  faqNoKnowledge: "אין לי תשובה במאגר הידע.",
  whyCollect: "אני מבקש פרטים כדי שאוכל לעזור עם הפנייה שלך. איך אפשר לעזור לך עכשיו?",
  askName: "מה שמך המלא?",
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
      `פרטי הפגישה: ${gathered}`,
      "לאשר או שתרצה להוסיף משהו?",
    ].join("\n"),
  bookingConfirmIntro: "הנה פרטי הפגישה, כדי שנוכל לוודא שהכול נכון:",
  bookingConfirmAsk: "ודא שהכול נכון, לשמור את הבקשה?",
  bookingDeclineAsk: "בסדר, לא שומרים את הבקשה. לשנות את המועד, או לעצור כאן?",
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
    offerReplacement: (from, to) =>
      `רשמתי ${from} עד ${to} במקום התאריכים שהוצעו. נציג יאשר אותם.`,
    offerUnclearAsk: "רק לוודא שהבנתי — התאריכים שהצענו מתאימים לך, או שנחפש אפשרות אחרת?",
  },
  documents: {
      askId: "כדי לאתר את התיק שלך, אשמח למספר תעודת זהות בן 9 ספרות.",
      notFound: "לא הצלחתי לאתר תיק לפי המספר הזה. אפשר לבדוק ולשלוח שוב?",
      notConfigured: "איסוף המסמכים עדיין לא הוגדר. נציג יחזור אליך בהקדם.",
      askStage: (docs) => `כדי להתקדם, אשמח לקבל את ${docs}.`,
      askIdCard: "אשמח לתמונה של תעודת הזהות עם הספח.",
      askPayslips: "אשמח לתלושי שכר של 3 החודשים האחרונים.",
      ownedBy: (label, who) => `${label} של ${who}`,
      forBorrower: (line, who) => `${line.replace(/[.?!]+\s*$/, "")} של ${who}.`,
      borrowerRole: {
        salaried: "הלווה השכיר",
        self_employed: "הלווה העצמאי",
        controlling_shareholder: "הלווה בעל השליטה",
        both: "הלווה השכיר והעצמאי",
      },
      borrowerOrder: { "1": "הלווה הראשון", "2": "הלווה השני" },
      askEmployment: (name) =>
        `כדי להתאים את רשימת המסמכים, מהו מצב התעסוקה של ${name} — שכיר/ה, עצמאי/ת, שכיר/ה בעל שליטה, או אחר?`,
      askSecondBorrower: "האם יש לווה נוסף בתיק?",
      askCouple: "האם אחד הלווים עצמאי והשני שכיר?",
      askSplitWho: (first, second) => `מי מהם עצמאי, ${first} או ${second}?`,
      askIdBiometric: (name) =>
        name ? `האם תעודת הזהות של ${name} ביומטרית?` : "האם תעודת הזהות ביומטרית?",
      askIdBack: "אשמח גם לצד השני של תעודת הזהות.",
      askFirstHome: "האם מדובר ברכישת דירה ראשונה?",
      askLoans: "האם יש לך הלוואות קיימות?",
      askMoreLoans: "האם יש לך הלוואה נוספת?",
      askAccounts: "אשמח גם לתדפיס עו״ש של שלושת החודשים האחרונים.",
      askSalaryDeposit: (name) =>
        `האם המשכורת שמופיעה בתלוש של ${name} נכנסת לחשבון הבנק האישי?`,
      askMorePhotos: "יש לך עוד תמונות של אותו מסמך?",
      howTo: (docType) => {
        const steps: Record<string, string> = {
          loan_balances: "יתרת ההלוואות עדיין נדרשת. אפשר להוציא אותה מהאזור האישי בבנק או מהאפליקציה, או לבקש מהבנק אישור יתרה לסילוק, ולשלוח אותה לכאן.",
          bank_statement: "תדפיס עו״ש של שלושת החודשים האחרונים אפשר להפיק מהאזור האישי בבנק או מהאפליקציה, ולייצא כ־PDF.",
          id_card: "אפשר לצלם את תעודת הזהות עם הספח בטלפון, במקום מואר, כך שהפרטים קריאים.",
          id_card_back: "אפשר לצלם את הצד השני של תעודת הזהות בטלפון, במקום מואר.",
          id_appendix: "אפשר לצלם את ספח תעודת הזהות בטלפון, כך שכל הפרטים נראים.",
          payslip: "תלושי שכר של שלושת החודשים האחרונים אפשר להוריד מאזור העובד או לבקש מהמעסיק.",
          tax_assessment: "שומת מס, או אישור פתיחת תיק, אפשר להוריד מהאזור האישי של רשות המסים או לבקש מרואה החשבון.",
          accountant_letter: "אפשר לבקש מרואה החשבון למלא את הטופס ולשלוח אותו לכאן.",
          controlling_shareholder_letter: "אפשר לבקש מרואה החשבון אישור לבעל שליטה ולשלוח אותו לכאן.",
        };
        return steps[docType] ?? "אפשר להוציא את המסמך מהגורם שמנפיק אותו ולשלוח אותו לכאן כקובץ או כתמונה.";
      },
      howToDetail: (docType) => {
        const steps: Record<string, string> = {
          loan_balances: "באתר או באפליקציה של הבנק נכנסים להלוואות ובוחרים אישור יתרה לסילוק, או מבקשים את האישור בסניף, ושומרים PDF.",
          bank_statement: "באתר או באפליקציה של הבנק נכנסים לעו״ש, מייצאים תנועות של שלושת החודשים האחרונים כ־PDF, בלי החודש הנוכחי.",
          id_card: "מצלמים את כרטיס תעודת הזהות יחד עם הספח, במקום מואר, כך שהשם והמספר קריאים.",
          id_card_back: "הופכים את כרטיס תעודת הזהות ומצלמים את הצד השני, לא רישיון נהיגה.",
          id_appendix: "מצלמים את דף הספח כולו, כך שכל השורות נראות.",
          payslip: "באזור העובד של המעסיק, או בבקשה מהמעסיק, מורידים את תלושי שלושת החודשים האחרונים.",
          tax_assessment: "נכנסים לאזור האישי של רשות המסים, בוחרים שומת מס או אישור פתיחת תיק לשנת המס, ומורידים PDF. אם אין כניסה, רואה החשבון יכול להוציא את זה.",
          accountant_letter: "שולחים לרואה החשבון את הטופס הריק שצורף, ומבקשים שימלא אותו לשנה הנוכחית ויחזיר PDF.",
          controlling_shareholder_letter: "מבקשים מרואה החשבון את אישור בעל השליטה כ־PDF ומצרפים אותו כאן.",
        };
        return steps[docType] ?? "פונים לגורם שמנפיק את המסמך, מבקשים עותק עדכני, ושולחים אותו לכאן כקובץ או כתמונה.";
      },
      revised: (kind, detail) => {
        const employment: Record<string, string> = {
          salaried: "שכיר/ה",
          self_employed: "עצמאי/ת",
          controlling_shareholder: "שכיר/ה בעל/ת שליטה",
          both: "שכיר/ה ועצמאי/ת",
          other: "אחר",
        };
        if (kind === "loans_known") return "רשמתי שיש הלוואות. נבקש את היתרה כשנגיע אליה.";
        if (kind === "employment") return `רשמתי שהתעסוקה היא ${employment[detail ?? ""] ?? "מעודכנת"}.`;
        if (kind === "second_yes") return "רשמתי שיש לווה נוסף.";
        if (kind === "second_no") return "רשמתי שאין לווה נוסף.";
        if (kind === "first_home_yes") return "רשמתי שזו דירה ראשונה.";
        if (kind === "first_home_no") return "רשמתי שזו לא דירה ראשונה.";
        if (kind === "couple_yes") return "רשמתי שאחד הלווים עצמאי והשני שכיר.";
        if (kind === "couple_no") return "רשמתי שזה לא המקרה של לווה עצמאי ולווה שכיר.";
        if (kind === "split_who" && detail === "2") return "רשמתי שהלווה השני עצמאי והראשון שכיר.";
        if (kind === "split_who") return "רשמתי שהלווה הראשון עצמאי והשני שכיר.";
        if (kind === "salary_yes") return "רשמתי שהמשכורת נכנסת לחשבון האישי.";
        if (kind === "salary_no") return "רשמתי שהמשכורת לא נכנסת לחשבון האישי.";
        if (kind === "more_loans") return "רשמתי שיש הלוואה נוספת.";
        return "רשמתי את העדכון.";
      },
      retracted: "הורדתי את הקובץ האחרון, הוא לא המסמך הנכון.",
      notIdBack: "זה לא הצד השני של תעודת הזהות. אשמח לצד השני של הכרטיס.",
      idBackTryAgain: "לא הצלחתי לקרוא את התמונה. אפשר לשלוח אותה שוב?",
      confirmChange: (kind, detail) => {
        const employment: Record<string, string> = {
          salaried: "שכיר/ה",
          self_employed: "עצמאי/ת",
          controlling_shareholder: "שכיר/ה בעל/ת שליטה",
          both: "שכיר/ה ועצמאי/ת",
          other: "אחר",
        };
        if (kind === "retract" && detail === "id_card_back") return "להוריד את הצד השני";
        if (kind === "retract") return "להוריד את הקובץ האחרון";
        if (kind === "employment") return `לרשום שהתעסוקה היא ${employment[detail ?? ""] ?? "מעודכנת"}`;
        if (kind === "loans" && detail === "none") return "לרשום שאין הלוואות";
        if (kind === "loans") return "לרשום שיש הלוואות";
        if (kind === "second_borrower" && detail === "no") return "לרשום שאין לווה נוסף";
        if (kind === "second_borrower") return "לרשום שיש לווה נוסף";
        if (kind === "first_home" && detail === "false") return "לרשום שזו לא דירה ראשונה";
        if (kind === "first_home") return "לרשום שזו דירה ראשונה";
        if (kind === "couple_split" && detail === "no") return "לרשום שזה לא המקרה של לווה עצמאי ולווה שכיר";
        if (kind === "couple_split") return "לרשום שאחד הלווים עצמאי והשני שכיר";
        if (kind === "split_who" && detail === "2") return "לרשום שהלווה השני עצמאי והראשון שכיר";
        if (kind === "split_who") return "לרשום שהלווה הראשון עצמאי והשני שכיר";
        if (kind === "salary_deposit" && detail === "no") return "לרשום שהמשכורת לא נכנסת לחשבון האישי";
        if (kind === "salary_deposit") return "לרשום שהמשכורת נכנסת לחשבון האישי";
        if (kind === "more_loans" && detail === "no") return "לרשום שאין הלוואה נוספת";
        if (kind === "more_loans") return "לרשום שיש הלוואה נוספת";
        if (kind === "how_to") return "להסביר מאיפה משיגים את המסמך";
        return "לעדכן את מה שאמרת";
      },
      confirmTurn: (changes) => `רק לוודא: ${changes.join(", ")}?`,
      noLoans: "רשמתי שאין הלוואות, אז לא צריך יתרת הלוואות.",
      blankForm: (doc) => `מצורף טופס ${doc}. אשמח שתמלא/י אותו ותשלח/י אותו בחזרה.`,
      nextStage: "אפשר להתקדם לשלב הבא. אשלח את רשימת המסמכים הבאה ברגע שתהיה מוכנה.",
      advisorFlag: (label) => `יש כאן פרט שמצריך בדיקה של יועץ: ${label}. בינתיים אפשר לשלוח תעודת זהות וספח.`,
      received: (doc) => `קיבלתי את ${doc}.`,
      rejected: (doc, reason, detail) => `לא הצלחתי לאשר את ${doc}: ${reason}.${detail ? ` ${detail}` : ""}`,
      complete: "המסמכים נשלחו לבדיקה. ניצור איתך קשר כשהעיבוד יסתיים, ואז נוכל להתקדם לשלב הבא.",
      returnFiles: (items) =>
        `צריך לשלוח מחדש:\n${items.map((item) => `• ${item.label} — ${item.note}`).join("\n")}\nאפשר לשלוח אותם כאן. הקובץ החדש יחליף את הקודם.`,
      askEscalate: "רוצה שאעביר את זה ליועץ, או שננסה שוב עוד מעט?",
      cooldownWait: (minutes) => `אפשר לנסות שוב בעוד כ־${minutes} דקות.`,
      escalateAccepted: "מעביר את זה ליועץ. הוא יחזור אליך בהקדם.",
      escalateDeclined: "בסדר. אפשר לנסות שוב אחרי ההמתנה, או לשלוח קובץ אחר.",
      escalated: "יועץ יעבור על זה ויחזור אליך.",
      uploadFailed: "קיבלתי את הקובץ, אבל הוא עדיין לא עלה למערכת. אנסה שוב בהודעה הבאה.",
      reasons: {
        field_present: "חסר בו פרט נדרש",
        id_number: "לא הצלחתי לקרוא את מספר תעודת הזהות. שלח בבקשה תמונה ברורה יותר של הכרטיס, כך שהשם והמספר נראים",
        matches_profile: "הפרטים בו לא תואמים לתיק",
        date_within_months: "התאריך שמופיע בו ישן מדי",
        prior_calendar_months: "הוא לא כולל את שלושת החודשים הקודמים",
        min_items: "חסרים בו פריטים נדרשים",
        wrong_type: "זה לא אחד המסמכים שחסרים כרגע",
        unrecognized: "לא זיהיתי את הקובץ כמסמך שביקשתי",
        unreadable: "לא הצלחתי לקרוא את הקובץ",
        no_model: "לא הצלחתי לקרוא את הקובץ",
        extract_failed: "לא הצלחתי לקרוא את הקובץ",
        too_large: "הקובץ גדול מדי",
        unsupported_type: `אפשר לשלוח ${supportedTypeLabels("או")}`,
      },
    },
};

/** System prompts stay in English so the model follows tools reliably. */
export const prompts: PromptCopy = {
  ...enPrompts,
  languageRule: "Reply only in Hebrew. Never mix in English filler.",
};
