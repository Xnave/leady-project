import { NextResponse } from "next/server";
import { batchLeadRefreshes } from "@/lib/crm/refresh";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { completeHitlTask, completeHitlTaskWithDirectReply, loadTurnContext } from "@/lib/conversations";
import { returnChecklistDocuments } from "@/lib/documents/dossier";
import { isChatLanguage, resolveReplyLanguage } from "@/lib/flow/locale";
import { sendStaffReply } from "@/lib/staff-reply";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { decideRegisteredRequest } from "@/lib/flow/registry";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { runTurnNow, sendAndSave, tryDispatchNudgeEvent, tryDispatchOwnerAlertEvents } from "@/lib/flow/run-turn";
import { getRequest, REQUEST_APPROVAL_TASK } from "@/lib/requests";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

/** Every CRM refresh the decision triggers (task, messages, closed thread) runs once, at the end. */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return batchLeadRefreshes(() => handle(req, ctx));
}

async function handle(
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
  if (String(form.get("mode") ?? "") === "return_files") {
    return returnChecklistFiles(tenantId, task, form);
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
  // A resume has no trigger message: anchor "tasks this turn opened" here, once.
  const tasksSince = Date.now();
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
      tasksSince,
    });
    await tryDispatchNudgeEvent(turn.nudgeEvent);
    await tryDispatchOwnerAlertEvents(turn.ownerAlertEvents);
  } catch (err) {
    console.error(JSON.stringify({ msg: "hitl.resume_failed", conversationId, error: String(err) }));
  }
  return NextResponse.json({ ok: true });
}

/** Decline specific files on a finished checklist and tell the customer what to send again. */
async function returnChecklistFiles(
  tenantId: string,
  task: { id: string; leadId: string | null; conversationId: string; reason: string; status: string },
  form: FormData,
) {
  if (task.status !== "open" || task.reason !== "document_checklist_complete" || !task.leadId) {
    return NextResponse.json({ error: "not_a_document_review" }, { status: 400 });
  }
  const groups = form.getAll("returnGroup").map(String).filter(Boolean).map((group) => ({
    slotIds: group.split("|").filter(Boolean),
    note: String(form.get(`returnNote__${group}`) ?? "").trim(),
  }));
  if (!groups.length || groups.some((group) => group.slotIds.length === 0 || !group.note)) {
    return NextResponse.json({ error: "empty_reply" }, { status: 400 });
  }
  const [tenant, latest] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId }, select: { chatLanguage: true } }),
    prisma.message.findFirst({
      where: { tenantId, role: "lead", conversationId: task.conversationId },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    }),
  ]);
  const stored = tenant?.chatLanguage ?? "";
  const policy = isChatLanguage(stored) ? stored : "multi";
  const lang = resolveReplyLanguage(policy, latest?.text ?? "");
  const result = await returnChecklistDocuments({
    tenantId,
    leadId: task.leadId,
    groups,
    lang,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 400 });
  }
  await sendStaffReply({
    tenantId,
    conversationId: task.conversationId,
    text: result.text,
    source: "document_return",
  });
  const actor = await resolveStaffActor();
  await completeHitlTaskWithDirectReply({
    tenantId,
    taskId: task.id,
    actorUserId: actor.actorUserId,
    reply: result.text,
    approved: false,
  });
  return NextResponse.json({ ok: true, returned: true });
}
