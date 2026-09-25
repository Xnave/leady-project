import { FOLLOW_UP_PRIORITY, type FollowUpReason } from "./types";

export type DigestItem = { leadId: string; name: string; reason: FollowUpReason; stand: string; at: Date };
export type Digest = { total: number; counts: Record<FollowUpReason, number>; top: DigestItem };

const rank = (r: FollowUpReason) => FOLLOW_UP_PRIORITY.indexOf(r);

export function buildDigest(items: DigestItem[]): Digest | null {
  if (items.length === 0) return null;
  const counts = { handoff: 0, approval: 0, reminder: 0, cold: 0 } as Record<FollowUpReason, number>;
  for (const i of items) counts[i.reason]++;
  const top = [...items].sort((a, b) => rank(a.reason) - rank(b.reason) || a.at.getTime() - b.at.getTime())[0];
  return { total: items.length, counts, top };
}

/** Meta template params: no newlines/tabs, no 4+ consecutive spaces, never empty. */
export function sanitizeTemplateParam(v: string, max = 80): string {
  const clean = v.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (!clean) return "-";
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : clean;
}

/** Order matches the approved template: name, total, approval, handoff, reminder, cold, top. */
export function digestTemplateParams(d: Digest, ownerName: string): string[] {
  return [
    sanitizeTemplateParam(ownerName, 40),
    String(d.total),
    String(d.counts.approval),
    String(d.counts.handoff),
    String(d.counts.reminder),
    String(d.counts.cold),
    sanitizeTemplateParam(`${d.top.name} · ${d.top.stand}`, 80),
  ];
}

export function digestFullText(
  items: DigestItem[],
  labels: Record<FollowUpReason, string>,
  appUrl: string,
): string {
  const lines = [...items]
    .sort((a, b) => rank(a.reason) - rank(b.reason) || a.at.getTime() - b.at.getTime())
    .map((i) => `• ${i.name} · ${labels[i.reason]}`);
  return [...lines, "", `${appUrl.replace(/\/$/, "")}/leads?tab=needs`].join("\n");
}

export function localDateAndHour(now: Date, tz: string): { date: string; hour: number } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
  return { date, hour };
}
