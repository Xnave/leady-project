import { cannedFallbackIntro } from "@/lib/copy";
import type { TurnContext } from "./types";

export function hasAgentReplied(ctx: TurnContext): boolean {
  return ctx.messages.some((m) => m.role === "agent" || m.role === "human");
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function idleResetDays(ctx: TurnContext): number {
  const n = ctx.tenant?.idleResetDays;
  if (typeof n !== "number" || !Number.isFinite(n)) return 5;
  return Math.max(0, Math.min(365, Math.floor(n)));
}

export function cannedIntroText(ctx: TurnContext): string {
  return cannedFallbackIntro(ctx);
}

function messageTime(value: Date | string | undefined): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

export function isIdleConversationReset(ctx: TurnContext): boolean {
  const days = idleResetDays(ctx);
  if (days <= 0) return false;
  const stamps = ctx.messages
    .map((m) => messageTime(m.createdAt))
    .filter((d): d is Date => d != null);
  if (stamps.length < 2) return false;
  const last = stamps[stamps.length - 1];
  const prev = stamps[stamps.length - 2];
  return last.getTime() - prev.getTime() >= days * DAY_MS;
}

export function shouldSendCannedIntro(
  ctx: TurnContext,
  opts?: { fromTerminal?: boolean },
): boolean {
  if (ctx.conversation.status === "waiting_human") return false;
  // New conversation (or restart onto talk with no agent yet) → static intro.
  if (!hasAgentReplied(ctx)) return true;
  if (opts?.fromTerminal) return true;
  return false;
}

export function looksLikeBareHello(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[!?.,]+$/g, "").trim();
  return /^(hi|hello|hey|yo|שלום|היי|הי)$/.test(t);
}

/** @deprecated Prefer cannedIntroText + extract-on-first-turn; kept for tests. */
export function prefixCannedIntro(
  ctx: TurnContext,
  reply: string,
  opts?: { fromTerminal?: boolean },
): string {
  const body = reply.trim();
  if (!shouldSendCannedIntro(ctx, opts)) return body;
  const intro = cannedIntroText(ctx).trim();
  if (!intro) return body;
  if (!body || body === intro) return intro;
  if (body.startsWith(intro)) return body;
  return `${intro}\n${body}`;
}
