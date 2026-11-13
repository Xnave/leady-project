/**
 * Pure rules for the documents auto-invite: when a message may go out, which
 * step a contact is due for, and how to read a reply. No DB, no clock: callers
 * pass `now`. The runner (`./run`) does the I/O.
 */

/** Reminder after the opener, and the advisor task after the reminder. Wall clock. */
export const INVITE_REMINDER_AFTER_MS = 48 * 3600_000;
/** A claim this old never got its result written: the send may or may not have happened. */
export const INVITE_CLAIM_STALE_MS = 10 * 60_000;
/** Template sends per tenant per run, so a big first sync cannot burst the advisor's number. */
export const INVITE_SEND_CAP = 20;

export type InviteStatus =
  | ""
  | "sending_opener"
  | "invited"
  | "sending_reminder"
  | "reminded"
  | "started"
  | "escalated"
  | "stopped"
  | "unknown";

/** Statuses where a reply from the contact means something to the invite. */
export const INVITE_OPEN_STATUSES: InviteStatus[] = [
  "sending_opener",
  "invited",
  "sending_reminder",
  "reminded",
  "escalated",
  "unknown",
];

export type InviteStep = "opener" | "reminder" | "escalate" | "unknown" | null;

const TIME_ZONE = "Asia/Jerusalem";
/** Opening hours per weekday (0 = Sunday), end exclusive. Saturday closed. */
const SEND_HOURS: Record<number, [number, number] | null> = {
  0: [9, 20],
  1: [9, 20],
  2: [9, 20],
  3: [9, 20],
  4: [9, 20],
  5: [9, 13],
  6: null,
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const localParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

/** Sun–Thu 09:00–20:00, Fri 09:00–13:00, Israel time. Never Saturday. */
export function inSendWindow(now: Date): boolean {
  const parts = localParts.formatToParts(now);
  const day = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const hours = SEND_HOURS[day];
  if (!hours || !Number.isFinite(hour)) return false;
  return hour >= hours[0] && hour < hours[1];
}

type PlanRow = {
  inviteStatus: string;
  inviteClaimedAt: Date | null;
  inviteOpenerAt: Date | null;
  inviteReminderAt: Date | null;
};

const since = (t: Date | null, now: Date) => (t ? now.getTime() - t.getTime() : -Infinity);

/** The step this contact is due for now. Send hours are the caller's check. */
export function planInviteStep(row: PlanRow, now: Date): InviteStep {
  switch (row.inviteStatus) {
    case "":
      return "opener";
    case "invited":
      return since(row.inviteOpenerAt, now) >= INVITE_REMINDER_AFTER_MS ? "reminder" : null;
    case "reminded":
      return since(row.inviteReminderAt, now) >= INVITE_REMINDER_AFTER_MS ? "escalate" : null;
    case "sending_opener":
    case "sending_reminder":
      return since(row.inviteClaimedAt, now) >= INVITE_CLAIM_STALE_MS ? "unknown" : null;
    default:
      return null;
  }
}

const STOP_WORDS = new Set(["הסר", "הסירו", "להסיר", "הסרה", "הפסק", "תפסיקו", "די", "stop", "unsubscribe", "remove"]);

/** The whole reply is a stop word ("הסר", "STOP!"). A sentence that mentions one is not. */
export function isStopReply(text: string): boolean {
  const word = text.trim().toLowerCase().replace(/[\s!?.,׳'"]+/g, " ").trim();
  return STOP_WORDS.has(word);
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const firstToken = (s: unknown) => (typeof s === "string" ? s.trim().split(/\s+/)[0] ?? "" : "");

/** `{{1}}`: borrower 1's first name from the stored checklist, else the contact's name. */
export function inviteFirstName(contact: { name: string; mapped: unknown }): string {
  const borrowers = record(record(contact.mapped).checklist).borrowers;
  const first = Array.isArray(borrowers) ? record(borrowers.find((b) => record(b).slot === "1") ?? borrowers[0]) : {};
  return firstToken(first.fullName) || firstToken(contact.name);
}

/** Only contacts stored after the switch went on (no backlog). No cutoff, no invite. */
export function invitedAfter(contactCreatedAt: Date, cutoff: Date | null): boolean {
  return Boolean(cutoff) && contactCreatedAt.getTime() > cutoff!.getTime();
}


export { whatsappExternalIdVariants } from "@/lib/whatsapp-ids";
