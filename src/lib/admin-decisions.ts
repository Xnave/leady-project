import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type AdminDecisionActor = {
  actorUserId: string;
  actorLabel?: string;
};

export type AppendAdminDecisionOpts = {
  tenantId: string;
  leadId?: string | null;
  conversationId?: string | null;
  /** Domain bucket, e.g. "request", "hitl", "lead". */
  category: string;
  /** Action within the category, e.g. "approve", "decline", "reschedule". */
  action: string;
  actorUserId: string;
  actorLabel?: string;
  /** Structured payload for the UI / future decision types. */
  details?: Record<string, unknown>;
  summary?: string;
  createdAt?: Date;
};

export function resolveActorLabel(actorUserId: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (actorUserId === "customer") return "customer";
  if (actorUserId === "owner") return "admin";
  return actorUserId || "admin";
}

/** Append-only admin decision row — use for every staff decision, not only meetings. */
export function appendAdminDecision(opts: AppendAdminDecisionOpts) {
  return prisma.adminDecisionLog.create({
    data: {
      tenantId: opts.tenantId,
      leadId: opts.leadId ?? null,
      conversationId: opts.conversationId ?? null,
      category: opts.category,
      action: opts.action,
      actorUserId: opts.actorUserId,
      actorLabel: resolveActorLabel(opts.actorUserId, opts.actorLabel),
      details: (opts.details ?? {}) as Prisma.InputJsonValue,
      summary: opts.summary?.trim() ?? "",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}
