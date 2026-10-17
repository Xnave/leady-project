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

/** Lines in the free-text list; the rest is summarised as `+N` (WhatsApp caps text at 4096 chars). */
export const FULL_TEXT_MAX_ITEMS = 30;

export function digestFullText(
  items: DigestItem[],
  labels: Record<FollowUpReason, string>,
  appUrl: string,
): string {
  const sorted = [...items].sort((a, b) => rank(a.reason) - rank(b.reason) || a.at.getTime() - b.at.getTime());
  const lines = sorted
    .slice(0, FULL_TEXT_MAX_ITEMS)
    .map((i) => sanitizeTemplateParam(`• ${i.name} · ${labels[i.reason]}`, 120));
  if (sorted.length > FULL_TEXT_MAX_ITEMS) lines.push(`+${sorted.length - FULL_TEXT_MAX_ITEMS}`);
  return [...lines, "", `${appUrl.replace(/\/$/, "")}/leads?tab=needs`].join("\n");
}

/**
 * Recipients not yet in a day's sent list. Used to resume a digest run after
 * a partial failure: only whoever isn't already recorded gets sent to again.
 */
export function pendingRecipients<T extends { clerkUserId: string }>(all: T[], sentIds: string[]): T[] {
  const sent = new Set(sentIds);
  return all.filter((r) => !sent.has(r.clerkUserId));
}

export function localDateAndHour(now: Date, tz: string): { date: string; hour: number } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
  return { date, hour };
}

/** WhatsApp lets a business send free text for 24h after the customer's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function serviceWindowOpen(lastInboundAt: Date | null | undefined, now: Date): boolean {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

/**
 * How one recipient gets today's digest:
 * - `text`: their window is open, so the full list goes as free text (no
 *   template fee, and it carries every item, not just counts);
 * - `template`: window closed, an approved template exists;
 * - `wait`: neither - nothing is sent, and the owner's next message to the
 *   platform number gets the full list (see `handleDigestReply`).
 */
export function digestDelivery(o: { windowOpen: boolean; hasConversation: boolean; hasTemplate: boolean }): "text" | "template" | "wait" {
  if (o.windowOpen && o.hasConversation) return "text";
  if (o.hasTemplate) return "template";
  return "wait";
}

export type OwnerCommand = { kind: "start"; code: string } | { kind: "stop" } | { kind: "other" };

/** Opt-in code length; the settings page shows `START <code>`. */
export const OPT_IN_CODE_LENGTH = 6;

/**
 * What an owner's message to the platform number asks for: `START 123456`
 * (or `הפעל 123456`) confirms an opt-in, `STOP` / `הסר` unsubscribes, and
 * anything else (including the template's quick-reply button) is a request
 * for the full list.
 */
export function parseOwnerCommand(text: string): OwnerCommand {
  const t = text.trim();
  const start = t.match(/^(?:start|הפעל)\s*(\d{6})$/i);
  if (start) return { kind: "start", code: start[1] };
  if (/^(?:stop|unsubscribe|הסר|הסרה|עצור)$/i.test(t)) return { kind: "stop" };
  return { kind: "other" };
}

/** Phone as WhatsApp sends it: digits only, country code included, no `+`. */
export function phoneDigits(v: string): string {
  return v.replace(/\D/g, "");
}
