import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { loadTurnContext } from "@/lib/conversations";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { decideRegisteredRequest } from "@/lib/flow/registry";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { sendAndSave } from "@/lib/flow/run-turn";
import {
  getRequest,
  REQUEST_APPROVAL_TASK,
  type RequestDecision,
} from "@/lib/requests";
import { requireTenantId } from "@/lib/tenant";
import { redirectPath } from "@/lib/request-url";
import { prisma } from "@/lib/db";

function parseDecision(form: FormData): RequestDecision {
  const raw = String(form.get("decision") ?? "").trim();
  if (raw === "decline" || raw === "reschedule" || raw === "approve") return raw;
  return String(form.get("approved") ?? "") === "yes" ? "approve" : "decline";
}

/**
 * One decide endpoint for every approval vertical. The alternative offered with a
 * reschedule is read off the shape of the request's time spine: a point takes one
 * value, a span takes two. Wording and persistence belong to the owning capability.
 */
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
  const redirectTo = String(form.get("redirect") ?? "").trim() || "/inbox";

  const request = await getRequest({ tenantId, requestId: id });
  if (!request) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const isSpan = Boolean(request.endAt);
  const alternativeStart = String(
    form.get(isSpan ? "alternativeCheckIn" : "alternativeSlot") ?? "",
  ).trim();
  const alternativeEnd = String(form.get("alternativeCheckOut") ?? "").trim();
  if (
    decision === "reschedule" &&
    (!alternativeStart || (isSpan && !alternativeEnd))
  ) {
    return NextResponse.redirect(redirectPath(req, redirectTo), 303);
  }

  // Allow deciding while an open approval task still targets this request (inbox
  // work), even if a newer conversation thread exists. Otherwise the request's
  // thread must still be the lead's latest conversation.
  const openTasks = await prisma.hitlTask.findMany({
    where: {
      tenantId,
      leadId: request.leadId,
      status: "open",
      type: REQUEST_APPROVAL_TASK,
    },
    select: { id: true, payload: true },
  });
  const hasOpenTask = openTasks.some(
    (t) => (t.payload as { requestId?: string })?.requestId === request.id,
  );
  if (!hasOpenTask) {
    const latest = await prisma.conversation.findFirst({
      where: { leadId: request.leadId, tenantId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latest || latest.id !== request.conversationId) {
      return NextResponse.json({ error: "stale_conversation" }, { status: 409 });
    }
  }

  ensureFlowRegistry();
  const actor = await resolveStaffActor();
  const result = await decideRegisteredRequest(request.capabilityId, {
    tenantId,
    requestId: request.id,
    actorUserId: actor.actorUserId,
    decision,
    note: note || undefined,
    customReply: customReply || undefined,
    alternativeStart: alternativeStart || undefined,
    alternativeEnd: alternativeEnd || undefined,
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
