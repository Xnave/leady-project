import { NextResponse } from "next/server";
import { loadTurnContext } from "@/lib/conversations";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { sendAndSave } from "@/lib/flow/run-turn";
import { markMeetingDecision, type MeetingDecision } from "@/lib/meetings";
import { requireTenantId } from "@/lib/tenant";
import { redirectPath } from "@/lib/request-url";

function parseDecision(form: FormData): MeetingDecision {
  const raw = String(form.get("decision") ?? "").trim();
  if (raw === "decline" || raw === "reschedule" || raw === "approve") return raw;
  // Backward compat with older forms that posted approved=yes|no
  return String(form.get("approved") ?? "") === "yes" ? "approve" : "decline";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const form = await req.formData();
  const decision = parseDecision(form);
  const note = String(form.get("note") ?? "").trim();
  const customReply = String(form.get("customReply") ?? "").trim();
  const alternativeSlot = String(form.get("alternativeSlot") ?? "").trim();
  if (decision === "reschedule" && !alternativeSlot) {
    return NextResponse.redirect(redirectPath(req, "/inbox"), 303);
  }
  const result = await markMeetingDecision({
    tenantId,
    meetingId: id,
    actorUserId: "owner",
    decision,
    note: note || undefined,
    customReply: customReply || undefined,
    alternativeSlot: alternativeSlot || undefined,
  });
  // Send on the booking conversation first so the confirmation is visible there.
  const ctx = await loadTurnContext(tenantId, result.conversationId);
  await sendAndSave(ctx, result.text);
  if (result.closeAsDone) {
    await closeConversationAsDone({
      tenantId,
      conversationId: result.conversationId,
    });
  }
  const redirectTo = String(form.get("redirect") ?? "").trim() || "/inbox";
  return NextResponse.redirect(redirectPath(req, redirectTo), 303);
}
