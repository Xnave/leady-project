import type { UiCopy, UiLang } from "@/lib/ui";

/** Local calendar day, used to bucket rows under a date heading. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type DayGroup<T> = { key: string; date: Date; items: T[] };

/**
 * Buckets an already-sorted list into consecutive day groups. Input order is
 * preserved, so a list sorted newest-first yields groups newest-first.
 */
export function groupByDay<T>(items: T[], at: (item: T) => Date): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const date = at(item);
    const key = dayKey(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, date, items: [item] });
  }
  return groups;
}

export function locale(lang: UiLang): string {
  return lang === "he" ? "he-IL" : "en-GB";
}

/** "Today" and "Yesterday" carry more meaning than a date, so they win. */
export function dayHeading(date: Date, ui: UiCopy, lang: UiLang, now = new Date()): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return ui.conversations.today;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday)) return ui.conversations.yesterday;
  return date.toLocaleDateString(locale(lang), {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Time of day for rows from today, a short date for everything older. */
export function rowTime(date: Date, lang: UiLang, now = new Date()): string {
  if (dayKey(date) === dayKey(now)) {
    return date.toLocaleTimeString(locale(lang), { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(locale(lang), { day: "numeric", month: "short" });
}

/** Day and month; the year appears only when it is not the current one. */
export function shortDate(date: Date, lang: UiLang, now = new Date()): string {
  return date.toLocaleDateString(locale(lang), {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * The colour of a row's state rail, and the order the list should worry about
 * them in. "Needs you" beats everything: a paused conversation or an unapproved
 * visit is money waiting on the owner.
 */
export type RowState = "needs_you" | "active" | "quiet";

export function rowState(row: {
  convoStatus?: string | null;
  pendingMeetings: number;
  leadStatus: string;
}): RowState {
  if (row.convoStatus === "waiting_human" || row.pendingMeetings > 0) return "needs_you";
  if (row.leadStatus === "won" || row.leadStatus === "lost") return "quiet";
  if (row.convoStatus === "closed") return "quiet";
  return "active";
}

const PREVIEW_MAX = 90;

/** One line of the last thing said, prefixed with who said it. */
export function messagePreview(
  message: { role: string; text: string } | undefined,
  ui: UiCopy,
): string {
  if (!message) return ui.conversations.noMessages;
  const text = message.text.replace(/\s+/g, " ").trim();
  const clipped = text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
  const who = ui.roles[message.role as keyof UiCopy["roles"]];
  return who ? `${who}: ${clipped}` : clipped;
}

/** Two letters at most. Upper-casing is a no-op on Hebrew and tidies Latin. */
export function avatarInitials(name: string): string {
  const words = name.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const initials =
    words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`;
  return initials.toLocaleUpperCase();
}
