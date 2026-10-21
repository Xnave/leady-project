/**
 * Instant owner alerts: one WhatsApp message from the Zapidly platform number
 * the moment a lead needs the owner (a new approval request or a handoff),
 * instead of waiting for tomorrow's digest. Recipients are the digest's
 * opted-in owners, so the phone proof, STOP and the 24h window are shared.
 *
 * This file is pure: which tasks alert, off-hours timing, and the template
 * wording Meta reviews. Sending lives in `./alerts-send`.
 */
import { REQUEST_APPROVAL_TASK } from "@/lib/requests";
import { localDateAndHour, sanitizeTemplateParam } from "./digest";
import type { DigestTemplate } from "./digest-templates";

export type AlertKind = "approval" | "handoff";

/** Same split the CRM uses: an approval task is an approval, any other open task is a handoff. */
export function alertKind(taskType: string): AlertKind {
  return taskType === REQUEST_APPROVAL_TASK ? "approval" : "handoff";
}

export const QUIET_MODES = ["hold", "digest"] as const;
export type QuietMode = (typeof QUIET_MODES)[number];

export type AlertSettings = {
  alertsEnabled: boolean;
  alertApprovals: boolean;
  alertHandoffs: boolean;
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  quietMode: string;
};

/** A tenant with no `TenantAlertSettings` row has these: alerts off, the rest at the schema defaults. */
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  alertsEnabled: false,
  alertApprovals: true,
  alertHandoffs: true,
  quietHoursEnabled: true,
  quietStartHour: 22,
  quietEndHour: 8,
  quietMode: "hold",
};

/** Whether local `hour` falls in [start, end); start > end spans midnight, start == end is off. */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Local minute of `now` in `tz` (0-59); differs from the UTC minute only in :30/:45 zones. */
function localMinute(now: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "2-digit" }).format(now));
}

/**
 * The first local quarter-hour in `tz` outside off hours [startHour, endHour),
 * normally `endHour`:00. Walks forward in 15-minute steps (every real zone
 * offset is a multiple of 15), so half-hour zones and DST need no special
 * case: when spring-forward skips `endHour`, the first hour after it wins.
 */
export function quietHoursEnd(now: Date, tz: string, startHour: number, endHour: number): Date {
  const step = 15 * 60 * 1000;
  let t = Math.ceil(now.getTime() / step) * step;
  for (let i = 0; i < 4 * 25; i++, t += step) {
    const at = new Date(t);
    if (!inQuietHours(localDateAndHour(at, tz).hour, startHour, endHour) && localMinute(at, tz) === 0) return at;
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

export type AlertPlan =
  | { send: true; at: Date }
  | { send: false; reason: "disabled" | "kind_off" | "quiet_hours" };

/**
 * When an alert of `kind` goes out: now, at the end of off hours ("hold"), or
 * never ("digest" mode in off hours - the daily digest picks the lead up).
 * "digest" mode holds instead when the tenant's digest is off, so the lead
 * still reaches the owner.
 */
export function planAlert(
  s: AlertSettings,
  kind: AlertKind,
  now: Date,
  tz: string,
  digestEnabled: boolean,
): AlertPlan {
  if (!s.alertsEnabled) return { send: false, reason: "disabled" };
  if (kind === "approval" ? !s.alertApprovals : !s.alertHandoffs) return { send: false, reason: "kind_off" };
  if (!s.quietHoursEnabled) return { send: true, at: now };
  const { hour } = localDateAndHour(now, tz);
  if (!inQuietHours(hour, s.quietStartHour, s.quietEndHour)) return { send: true, at: now };
  if (s.quietMode === "digest" && digestEnabled) return { send: false, reason: "quiet_hours" };
  return { send: true, at: quietHoursEnd(now, tz, s.quietStartHour, s.quietEndHour) };
}

export type AlertTemplate = Omit<DigestTemplate, "sector">;

const FOOTER = "להפסקת ההודעות השיבו: הסר";
/** Same quick reply as the digest: tapping it opens the 24h window and gets the full list. */
const BUTTON = "הצג רשימה מלאה";

/** Last body line per kind; the free-text copy swaps it for a link to the lead. */
const CTA_LINE: Record<AlertKind, string> = {
  approval: "לאישור או דחייה היכנסו ל-Zapidly.",
  handoff: "למענה ללקוח היכנסו ל-Zapidly.",
};
const CTA_LINK: Record<AlertKind, string> = {
  approval: "לאישור או דחייה:",
  handoff: "למענה ללקוח:",
};

/** Variables, same order for both kinds: {{1}} business name, {{2}} lead name, {{3}} what it is about. */
export const ALERT_TEMPLATES: Record<AlertKind, AlertTemplate> = {
  approval: {
    name: "zapidly_alert_approval_v1",
    language: "he",
    category: "UTILITY",
    body: ["בקשה חדשה ממתינה לאישורך ב-{{1}}.", "", "לקוח: {{2}}", "פרטים: {{3}}", "", CTA_LINE.approval].join("\n"),
    footer: FOOTER,
    button: BUTTON,
    example: ["צימרי הגליל", "יוסי כהן", "12-14/11, 2 לילות"],
  },
  handoff: {
    name: "zapidly_alert_handoff_v1",
    language: "he",
    category: "UTILITY",
    body: ["לקוח מחכה לתשובה ממך ב-{{1}}.", "", "לקוח: {{2}}", "מה צריך: {{3}}", "", CTA_LINE.handoff].join("\n"),
    footer: FOOTER,
    button: BUTTON,
    example: ["סטודיו נועה", "יוסי כהן", "שואל על מחיר לקבוצה של 10"],
  },
};

/**
 * One line on what the task is about. Approvals lead with the requested time;
 * handoffs with the conversation summary, else the reason's label.
 */
export function alertDetail(
  kind: AlertKind,
  task: { reason: string; payload: unknown },
  reasonLabels: Record<string, string>,
): string {
  const p =
    task.payload && typeof task.payload === "object" && !Array.isArray(task.payload)
      ? (task.payload as Record<string, unknown>)
      : {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const parts =
    kind === "approval"
      ? [str(p.timeText), str(p.summary)]
      : [str(p.summary) || reasonLabels[task.reason] || ""];
  return parts.filter(Boolean).join(" · ");
}

export function alertTemplateParams(businessName: string, leadName: string, detail: string): string[] {
  return [
    sanitizeTemplateParam(businessName, 40),
    sanitizeTemplateParam(leadName, 40),
    sanitizeTemplateParam(detail, 100),
  ];
}

/** The template's wording as free text for an open window, with the call to action as a link to the lead. */
export function alertTemplateText(kind: AlertKind, params: string[], appUrl: string, leadId: string): string {
  const t = ALERT_TEMPLATES[kind];
  const body = t.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
  const link = `${CTA_LINK[kind]} ${appUrl.replace(/\/$/, "")}/leads/${leadId}`;
  return [body.replace(CTA_LINE[kind], link), "", t.footer].join("\n");
}
