import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { completeHitlTask, loadTurnContext } from "@/lib/conversations";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { decideRegisteredRequest } from "@/lib/flow/registry";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { dispatchNudgeEvent, runTurnNow, sendAndSave } from "@/lib/flow/run-turn";
import { getRequest, REQUEST_APPROVAL_TASK } from "@/lib/requests";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { redirectPath } from "@/lib/request-url";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const form = await req.formData();
  const note = String(form.get("note") ?? "");
  const approved = String(form.get("approved") ?? "") === "yes";
  const customReply = String(form.get("customReply") ?? "").trim();

  const task = await prisma.hitlTask.findFirstOrThrow({
    where: { id, tenantId },
  });
  const requestId =
    task.type === REQUEST_APPROVAL_TASK
      ? (task.payload as { requestId?: string }).requestId
      : undefined;
  const request = requestId
    ? await getRequest({ tenantId, requestId })
    : undefined;

  if (request) {
    const rawDecision = String(form.get("decision") ?? "").trim();
    const decision =
      rawDecision === "approve" || rawDecision === "decline" || rawDecision === "reschedule"
        ? rawDecision
        : approved
          ? "approve"
          : "decline";
    // A span offers two alternative dates on reschedule; a point offers one slot.
    const isSpan = Boolean(request.endAt);
    ensureFlowRegistry();
    const actor = await resolveStaffActor();
    const result = await decideRegisteredRequest(request.capabilityId, {
      tenantId,
      requestId: request.id,
      actorUserId: actor.actorUserId,
      decision,
      note: note || undefined,
      customReply: customReply || undefined,
      alternativeStart:
        String(form.get(isSpan ? "alternativeCheckIn" : "alternativeSlot") ?? "").trim() ||
        undefined,
      alternativeEnd: String(form.get("alternativeCheckOut") ?? "").trim() || undefined,
    });
    const ctx = await loadTurnContext(tenantId, result.conversationId);
    await sendAndSave(ctx, result.text);
    if (result.closeAsDone) {
      await closeConversationAsDone({
        tenantId,
        conversationId: result.conversationId,
        reason: "approve",
      });
    }
    return NextResponse.redirect(redirectPath(req, "/inbox"), 303);
  }

  const actor = await resolveStaffActor();
  const { conversationId } = await completeHitlTask({
    tenantId,
    taskId: id,
    actorUserId: actor.actorUserId,
    note,
    approved,
  });
  const turn = await runTurnNow({
    tenantId,
    conversationId,
    resume: true,
  });
  await dispatchNudgeEvent(turn.nudgeEvent);
  return NextResponse.redirect(redirectPath(req, "/inbox"), 303);
}
