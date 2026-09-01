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
  if (!hasAgentReplied(ctx)) return true;
  if (opts?.fromTerminal) return true;
  return isIdleConversationReset(ctx);
}
