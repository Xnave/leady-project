/** Pure helpers for the lead view (peek panel and full page). No React, no fetch. */
import type { LeadRowDTO, LeadViewDTO } from "@/lib/crm/view";

type Lang = "he" | "en";

/** Keys of `ui.crm.autoReasons`. */
export type AutoReasonKey =
  | "first_message"
  | "engaged"
  | "intent"
  | "flow"
  | "collected"
  | "requestPending"
  | "requestApproved"
  | "revived";

/**
 * Map a stored auto `stageReason` (from `collectSignals` / `decideStage`) to its copy key:
 * `request:*:pending`, `request:*:approved`, `flow:*`, `intent:*`, `collect:*`,
 * `contact_collected`, `engaged`, `first_message`, `revived`. Unknown reasons give null.
 */
export function autoReasonKey(reason: string): AutoReasonKey | null {
  const r = reason.trim();
  if (r.startsWith("request:") && r.endsWith(":pending")) return "requestPending";
  if (r.startsWith("request:") && r.endsWith(":approved")) return "requestApproved";
  if (r.startsWith("flow:")) return "flow";
  if (r.startsWith("intent:")) return "intent";
  if (r.startsWith("collect:") || r === "contact_collected") return "collected";
  if (r === "engaged" || r === "first_message" || r === "revived") return r;
  return null;
}

/** The actor of the most recent manual change into the current stage, from the timeline. */
export function manualStageActor(dto: Pick<LeadViewDTO, "stage" | "timeline">): string {
  for (const g of dto.timeline) {
    for (const it of g.items) {
      if (it.kind !== "stage") continue;
      if (it.data.source !== "manual") return "";
      return typeof it.data.actor === "string" ? it.data.actor : "";
    }
  }
  return "";
}

const ROW_KEYS = [
  "name",
  "handle",
  "channel",
  "stage",
  "stageSource",
  "followUpReason",
  "followUpAt",
  "due",
  "snoozedUntil",
  "nextStepText",
  "nextStepAt",
  "stand",
  "lastAt",
  "lastBy",
  "windowHoursLeft",
  "windowClosed",
  "demo",
  "intent",
] as const satisfies readonly (keyof LeadRowDTO)[];

/**
 * The list-row fields of a freshly loaded view, to merge into the list after a change.
 * `unread` is left out: a view loaded while the read POST is in flight may still say
 * unread and would bring the dot back.
 */
export function rowPatchFromView(dto: LeadViewDTO): Partial<LeadRowDTO> & { id: string } {
  const out: Record<string, unknown> = { id: dto.id };
  for (const k of ROW_KEYS) out[k] = dto[k];
  return out as Partial<LeadRowDTO> & { id: string };
}

export type TimelineFilter = "all" | "notes" | "stages" | "requests";
export const TIMELINE_FILTERS: TimelineFilter[] = ["all", "notes", "stages", "requests"];

export function timelineMatches(kind: string, f: TimelineFilter): boolean {
  if (f === "all") return true;
  if (f === "notes") return kind === "note";
  if (f === "stages") return kind === "stage";
  return kind === "request";
}

/** `YYYY-MM-DD` for a moment in the browser's zone (the same shape as the timeline's day keys). */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A timeline day header: today, yesterday, or the formatted date. */
export function dayLabel(day: string, now: Date, lang: Lang, labels: { today: string; yesterday: string }): string {
  if (day === dayKey(now)) return labels.today;
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day === dayKey(y)) return labels.yesterday;
  const [yy, mm, dd] = day.split("-").map(Number);
  const d = new Date(yy, mm - 1, dd);
  return d.toLocaleDateString(lang === "he" ? "he-IL" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: yy !== now.getFullYear() ? "numeric" : undefined,
  });
}

/** 09:00 browser-local on a picked `YYYY-MM-DD`, as an ISO string (matches the presets). */
export function dateInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], 9, 0, 0, 0).toISOString();
}

/** A `YYYY-MM-DD` value for `<input type="date">` from an ISO moment (browser zone). */
export function isoToDateInput(iso: string | null): string {
  return iso ? dayKey(new Date(iso)) : "";
}

/** Time of day for timeline items. */
export function clockTime(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleTimeString(lang === "he" ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit" });
}
