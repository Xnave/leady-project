import { NextResponse } from "next/server";
import { completeHitlTask, loadTurnContext } from "@/lib/conversations";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { runTurnNow, sendAndSave } from "@/lib/flow/run-turn";
import { markMeetingDecision } from "@/lib/meetings";
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
  if (task.type === "booking_approval") {
    const payload = task.payload as { meetingId?: string };
    if (payload.meetingId) {
      const rawDecision = String(form.get("decision") ?? "").trim();
      const decision =
        rawDecision === "approve" || rawDecision === "decline" || rawDecision === "reschedule"
          ? rawDecision
          : approved
            ? "approve"
            : "decline";
      const alternativeSlot = String(form.get("alternativeSlot") ?? "").trim();
      const result = await markMeetingDecision({
        tenantId,
        meetingId: payload.meetingId,
        actorUserId: "owner",
        decision,
        note: note || undefined,
        customReply: customReply || undefined,
        alternativeSlot: alternativeSlot || undefined,
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
  }

  const { conversationId } = await completeHitlTask({
    tenantId,
    taskId: id,
    actorUserId: "owner",
    note,
    approved,
  });
  await runTurnNow({
    tenantId,
    conversationId,
    resume: true,
  });
  return NextResponse.redirect(redirectPath(req, "/inbox"), 303);
}
