import { normalizeSlot } from "@/lib/flow/slot";

const DAY_MS = 24 * 60 * 60 * 1000;
/** If slot date cannot be parsed, keep approved meetings relevant this long after decision. */
const APPROVED_FALLBACK_RELEVANCE_MS = 2 * DAY_MS;

/**
 * Whether talk should treat this meeting as an active follow-up thread.
 * Pending = yes. Rejected = no. Approved = only until end of the scheduled day
 * (or 48h after decide when the slot date cannot be parsed).
 */
export function isMeetingStillRelevant(
  meeting: {
    status: string;
    slotText: string;
    decidedAt?: Date | string | null;
    updatedAt?: Date | string | null;
  },
  now: Date = new Date(),
): boolean {
  if (meeting.status === "pending") return true;
  if (meeting.status !== "approved") return false;

  const he = normalizeSlot(meeting.slotText, { now, lang: "he" });
  const parsed = he.dateIso ? he : normalizeSlot(meeting.slotText, { now, lang: "en" });
  const dateIso = parsed.dateIso;
  if (dateIso) {
    // Relevant through the end of the slot's calendar day (local).
    const endOfSlotDay = new Date(`${dateIso}T23:59:59.999`);
    return now.getTime() <= endOfSlotDay.getTime();
  }

  const stampRaw = meeting.decidedAt ?? meeting.updatedAt;
  if (!stampRaw) return false;
  const stamp = stampRaw instanceof Date ? stampRaw : new Date(stampRaw);
  if (Number.isNaN(stamp.getTime())) return false;
  return now.getTime() - stamp.getTime() <= APPROVED_FALLBACK_RELEVANCE_MS;
}
