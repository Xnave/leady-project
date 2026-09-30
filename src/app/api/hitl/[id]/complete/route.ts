import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { completeHitlTask, completeHitlTaskWithDirectReply, loadTurnContext } from "@/lib/conversations";
import { sendStaffReply } from "@/lib/staff-reply";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { decideRegisteredRequest } from "@/lib/flow/registry";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { runTurnNow, sendAndSave, tryDispatchNudgeEvent } from "@/lib/flow/run-turn";
import { getRequest, REQUEST_APPROVAL_TASK } from "@/lib/requests";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

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

  const task = await prisma.hitlTask.findFirst({
    where: { id, tenantId },
  });
  if (!task) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (task.status !== "open" && task.type !== REQUEST_APPROVAL_TASK) {
    return NextResponse.json({ error: "already_resolved" }, { status: 409 });
  }
  if (task.type !== REQUEST_APPROVAL_TASK && !note.trim()) {
    return NextResponse.json({ error: "empty_reply" }, { status: 400 });
  }
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
    return NextResponse.json({ ok: true });
  }

  // Answer the customer directly: send the text, close the task, no bot turn.
  if (String(form.get("mode") ?? "") === "direct") {
    const actor = await resolveStaffActor();
    await sendStaffReply({ tenantId, conversationId: task.conversationId, text: note.trim(), source: "hitl_direct" });
    await completeHitlTaskWithDirectReply({ tenantId, taskId: id, actorUserId: actor.actorUserId, reply: note.trim() });
    return NextResponse.json({ ok: true, direct: true });
  }

  const actor = await resolveStaffActor();
  const { conversationId } = await completeHitlTask({
    tenantId,
    taskId: id,
    actorUserId: actor.actorUserId,
    note,
    approved,
  });
  // The owner's reply is saved and sent; the bot's follow-up turn is best effort, so a
  // failure there is logged rather than reported as a failed send.
  try {
    const turn = await runTurnNow({
      tenantId,
      conversationId,
      resume: true,
    });
    await tryDispatchNudgeEvent(turn.nudgeEvent);
  } catch (err) {
    console.error(JSON.stringify({ msg: "hitl.resume_failed", conversationId, error: String(err) }));
  }
  return NextResponse.json({ ok: true });
}
