import { NextResponse } from "next/server";
import { completeHitlTask, loadTurnContext, persistStage } from "@/lib/conversations";
import { runTurnNow, sendAndSave } from "@/lib/flow/run-turn";
import { markMeetingDecision } from "@/lib/meetings";
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

  const task = await prisma.hitlTask.findFirstOrThrow({
    where: { id, tenantId },
  });
  if (task.type === "booking_approval") {
    const payload = task.payload as { meetingId?: string };
    if (payload.meetingId) {
      const result = await markMeetingDecision({
        tenantId,
        meetingId: payload.meetingId,
        actorUserId: "owner",
        approved,
      });
      const ctx = await loadTurnContext(tenantId, result.conversationId);
      await sendAndSave(ctx, result.text);
      if (result.reopenTalk) {
        await persistStage(tenantId, result.conversationId, "talk");
      }
      return NextResponse.redirect(new URL("/inbox", req.url), 303);
    }
  }

  await completeHitlTask({
    tenantId,
    taskId: id,
    actorUserId: "owner",
    note,
    approved,
  });
  await runTurnNow({
    tenantId,
    conversationId: task.conversationId,
    resume: true,
  });
  return NextResponse.redirect(new URL("/inbox", req.url), 303);
}
