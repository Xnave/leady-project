import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveActorLabel } from "@/lib/admin-decisions";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { isChatLanguage, resolveReplyLanguage } from "@/lib/flow/locale";

/** Needs-you reasons the documents capability opens. */
export const DOCUMENT_TASK_REASONS = ["document_checklist_complete", "document_review"] as const;
export const CHECKLIST_REVIEW_REASON = "document_checklist_complete";

/** Lead-facing language for an advisor action, from the tenant policy and the lead's last message. */
export async function leadReplyLang(tenantId: string, leadId: string): Promise<"en" | "he"> {
  const [tenant, latest] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId }, select: { chatLanguage: true } }),
    prisma.message.findFirst({
      where: { tenantId, role: "lead", conversation: { leadId, tenantId } },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    }),
  ]);
  const stored = tenant?.chatLanguage ?? "";
  const policy = isChatLanguage(stored) ? stored : "multi";
  return resolveReplyLanguage(policy, latest?.text ?? "");
}

/**
 * Close the open checklist review without messaging the lead.
 * `approved` false records that the advisor sent files back or asked for more instead.
 */
export async function closeChecklistReview(opts: {
  tenantId: string;
  leadId: string;
  actorUserId: string;
  approved: boolean;
  outcome: "approved" | "returned" | "requested";
}): Promise<boolean> {
  const task = await prisma.hitlTask.findFirst({
    where: { tenantId: opts.tenantId, leadId: opts.leadId, reason: CHECKLIST_REVIEW_REASON, status: "open" },
    orderBy: { createdAt: "desc" },
  });
  if (!task) return false;
  await prisma.$transaction([
    prisma.hitlTask.update({
      where: { id: task.id },
      data: {
        status: "done",
        resolution: { approved: opts.approved, documents: opts.outcome } as Prisma.InputJsonValue,
        completedBy: opts.actorUserId,
        completedAt: new Date(),
      },
    }),
    prisma.adminDecisionLog.create({
      data: {
        tenantId: opts.tenantId,
        leadId: task.leadId,
        conversationId: task.conversationId,
        category: "hitl",
        action: opts.approved ? "approve" : "decline",
        actorUserId: opts.actorUserId,
        actorLabel: resolveActorLabel(opts.actorUserId),
        summary: "",
        details: { hitlTaskId: task.id, reason: task.reason, type: task.type, documents: opts.outcome } as Prisma.InputJsonValue,
      },
    }),
  ]);
  await safeRefreshLeadState(opts.tenantId, opts.leadId);
  return true;
}
