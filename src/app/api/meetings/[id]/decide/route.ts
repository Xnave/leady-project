import { NextResponse } from "next/server";
import { loadTurnContext, persistStage } from "@/lib/conversations";
import { sendAndSave } from "@/lib/flow/run-turn";
import { markMeetingDecision } from "@/lib/meetings";
import { requireTenantId } from "@/lib/tenant";
import { redirectPath } from "@/lib/request-url";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const form = await req.formData();
  const approved = String(form.get("approved") ?? "") === "yes";
  const result = await markMeetingDecision({
    tenantId,
    meetingId: id,
    actorUserId: "owner",
    approved,
  });
  const ctx = await loadTurnContext(tenantId, result.conversationId);
  await sendAndSave(ctx, result.text);
  if (result.reopenTalk) {
    await persistStage(tenantId, result.conversationId, "talk");
  }
  return NextResponse.redirect(redirectPath(req, "/leads"), 303);
}
