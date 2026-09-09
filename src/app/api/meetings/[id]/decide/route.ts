import { NextResponse } from "next/server";
import { loadTurnContext } from "@/lib/conversations";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { sendAndSave } from "@/lib/flow/run-turn";
import { markMeetingDecision, type MeetingDecision } from "@/lib/meetings";
import { requireTenantId } from "@/lib/tenant";
import { redirectPath } from "@/lib/request-url";
import { prisma } from "@/lib/db";

function parseDecision(form: FormData): MeetingDecision {
  const raw = String(form.get("decision") ?? "").trim();
  if (raw === "decline" || raw === "reschedule" || raw === "approve") return raw;
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
  const redirectTo = String(form.get("redirect") ?? "").trim() || "/inbox";
  if (decision === "reschedule" && !alternativeSlot) {
    return NextResponse.redirect(redirectPath(req, redirectTo), 303);
  }

  const meeting = await prisma.meeting.findFirst({
    where: { id, tenantId },
    select: { id: true, leadId: true, conversationId: true },
  });
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Allow decide while an open booking HITL still targets this meeting (inbox work),
  // even if a newer conversation thread exists. Otherwise require the meeting's thread
  // to be the lead's latest conversation.
  const openHitlForMeeting = await prisma.hitlTask.findMany({
    where: {
      tenantId,
      leadId: meeting.leadId,
      status: "open",
      type: "booking_approval",
    },
    select: { id: true, payload: true },
  });
  const hasOpenHitl = openHitlForMeeting.some((t) => {
    const payload = t.payload as { meetingId?: string };
    return payload.meetingId === meeting.id;
  });
  if (!hasOpenHitl) {
    const latest = await prisma.conversation.findFirst({
      where: { leadId: meeting.leadId, tenantId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latest || latest.id !== meeting.conversationId) {
      return NextResponse.json({ error: "stale_conversation" }, { status: 409 });
    }
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
  const ctx = await loadTurnContext(tenantId, result.conversationId);
  await sendAndSave(ctx, result.text);
  if (result.closeAsDone) {
    await closeConversationAsDone({
      tenantId,
      conversationId: result.conversationId,
      reason: "approve",
    });
  }
  return NextResponse.redirect(redirectPath(req, redirectTo), 303);
}
