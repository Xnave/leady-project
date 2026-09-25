import { auth, currentUser } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { adminBypass, primaryEmailFromClerkUser } from "@/lib/admin";
import { prisma } from "@/lib/db";
import {
  GLOBAL_ADMIN_ACTOR,
  resolveActorLabel,
} from "@/lib/decision-actor";

export {
  AUTOMATIC_ACTOR,
  GLOBAL_ADMIN_ACTOR,
  formatDecisionActor,
  resolveActorLabel,
} from "@/lib/decision-actor";

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

/**
 * Who is deciding right now. Prefer the signed-in admin email; fall back to
 * `global_admin` when there is no identity (local DEV_AUTH_BYPASS without Clerk).
 */
export async function resolveStaffActor(): Promise<{
  actorUserId: string;
  actorLabel: string;
}> {
  if (adminBypass()) return { actorUserId: GLOBAL_ADMIN_ACTOR, actorLabel: GLOBAL_ADMIN_ACTOR };
  const user = await currentUser();
  const email = await primaryEmailFromClerkUser(user);
  if (email) {
    return { actorUserId: email, actorLabel: email };
  }
  const { userId } = await auth();
  if (userId) {
    return { actorUserId: userId, actorLabel: "admin" };
  }
  return { actorUserId: GLOBAL_ADMIN_ACTOR, actorLabel: GLOBAL_ADMIN_ACTOR };
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
