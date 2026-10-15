/** Lead-facing rapid-demo lines. Both languages live here so prod copy stays untouched. */

export type DemoLang = "en" | "he";

export function demoFooter(lang: DemoLang): string {
  if (lang === "he") {
    return "זו הדגמה שנוצרה על ידי Zapidly.com . הקלד ״חדש״ להתחלה מחדש או ״משימות״ להצגת המשימות.";
  }
  return 'This is a demo created by Zapidly.com. Type "new" to start over or "tasks" to show open tasks.';
}

const FOOTER_MARKERS = [
  "This is a demo created by Zapidly",
  "זו הדגמה שנוצרה על ידי Zapidly",
];

export function decorateRapidDemoText(text: string, lang: DemoLang): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (FOOTER_MARKERS.some((marker) => trimmed.includes(marker))) return trimmed;
  return `${trimmed}\n\n${demoFooter(lang)}`;
}

export function starterText(lang: DemoLang): string {
  return lang === "he" ? "מתחילים את ההדגמה…" : "Starting your demo…";
}

/** Drop the demo footer so a later model reads only what the business said. */
export function stripDemoFooter(text: string): string {
  let cut = text.length;
  for (const marker of FOOTER_MARKERS) {
    const at = text.indexOf(marker);
    if (at >= 0 && at < cut) cut = at;
  }
  return text.slice(0, cut).trim();
}

export function tasksEmptyText(lang: DemoLang): string {
  return lang === "he" ? "אין משימות אישור פתוחות." : "No open approval tasks.";
}

export function tasksListText(lang: DemoLang, lines: string[]): string {
  const body = lines.map((line) => `• ${line}`).join("\n");
  return lang === "he" ? `משימות אישור פתוחות:\n${body}` : `Open approval tasks:\n${body}`;
}

export function hitlNoticeText(lang: DemoLang, lines: string[]): string {
  const body = lines.map((line) => `• ${line}`).join("\n");
  if (lang === "he") {
    return `נוצרה משימה שהעסק צריך לאשר:\n${body}\n\nזוהי רק הדגמה, במוצר האמיתי תוכל לנהל פניות ובקשות דרך האתר`;
  }
  return `A task was created for the business to confirm:\n${body}\n\nIn the live product the team confirms this in Zapidly, so the bot pauses until then.`;
}

export function unboundCommandText(lang: DemoLang): string {
  return lang === "he"
    ? "כדי להתחיל, שלחו את הודעת ההדגמה מהקישור."
    : "To start, send the demo message from your link.";
}

/** Appended to agent knowledge so the activation code is not treated as a customer question. */
export const DEMO_ACTIVATION_NOTE = [
  "If a customer message only activates a Zapidly demo (it contains a code shaped like ZD-XXXXXXXX), greet them as this business.",
  "Do not mention the code, Zapidly, or that this is a demo.",
  "On a greeting, share specific details from this file: services, location, and hours. Do not offer a visit, a branch, or a time unless they ask to schedule.",
  "אם הודעת הלקוח היא רק הפעלת הדגמה של Zapidly (קוד בצורת ZD-XXXXXXXX), ברכו אותם כעסק הזה.",
  "אל תזכירו את הקוד, את Zapidly, או שזו הדגמה.",
  "בברכה, ספרו פרטים מהקובץ: שירותים, מיקום ושעות. אל תציעו ביקור, סניף או שעה אלא אם ביקשו לקבוע.",
].join("\n");
