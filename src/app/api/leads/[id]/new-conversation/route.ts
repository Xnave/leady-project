import { NextResponse } from "next/server";
import {
  closeConversationAsDone,
  reopenConversation,
  rotateConversation,
} from "@/lib/flow/rotate-conversation";
import {
  clearLeadForceFreshInbound,
  markLeadForceFreshInbound,
} from "@/lib/conversations";
import { requireTenantId } from "@/lib/tenant";
import { redirectPath } from "@/lib/request-url";
import { prisma } from "@/lib/db";

type Intent = "end" | "start" | "reopen";

function parseIntent(raw: string): Intent {
  if (raw === "start" || raw === "reopen") return raw;
  return "end";
}

/**
 * intent=end: close the active conversation (no new thread).
 * intent=start: open a brand-new empty conversation (refuses if one is already open).
 * intent=reopen: reopen this closed conversation (refuses if another open exists).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params;
  const tenantId = await requireTenantId();
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const form = await req.formData().catch(() => null);
  const intent = parseIntent(String(form?.get("intent") ?? "end").trim());
  const conversationId = String(form?.get("conversationId") ?? "").trim();

  const openConvo = await prisma.conversation.findFirst({
    where: { leadId, tenantId, status: { not: "closed" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let redirectConvoId: string | null = conversationId || openConvo?.id || null;

  try {
    if (intent === "end") {
      const toClose =
        conversationId ||
        openConvo?.id ||
        (
          await prisma.conversation.findFirst({
            where: { leadId, tenantId, status: { not: "closed" } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          })
        )?.id;
      if (toClose) {
        await closeConversationAsDone({
          tenantId,
          conversationId: toClose,
          reason: "admin",
        });
        redirectConvoId = toClose;
      }
      // Ensure no zombie open threads remain for this lead after an explicit end.
      const leftoverOpen = await prisma.conversation.findMany({
        where: { leadId, tenantId, status: { not: "closed" } },
        select: { id: true },
      });
      for (const row of leftoverOpen) {
        await closeConversationAsDone({
          tenantId,
          conversationId: row.id,
          reason: "admin",
        });
      }
      await markLeadForceFreshInbound(tenantId, leadId);
    } else if (intent === "start") {
      if (openConvo) {
        const accept = req.headers.get("accept") ?? "";
        if (accept.includes("application/json")) {
          return NextResponse.json(
            { error: "open_conversation_exists", openConversationId: openConvo.id },
            { status: 409 },
          );
        }
        return NextResponse.redirect(
          redirectPath(req, `/leads/${leadId}?c=${openConvo.id}`),
          303,
        );
      }
      await clearLeadForceFreshInbound(tenantId, leadId);
      const rotated = await rotateConversation({
        tenantId,
        leadId,
        reason: "admin",
      });
      redirectConvoId = rotated.conversationId;
    } else {
      // reopen
      if (!conversationId) {
        return NextResponse.json({ error: "conversationId_required" }, { status: 400 });
      }
      if (openConvo && openConvo.id !== conversationId) {
        return NextResponse.json(
          { error: "open_conversation_exists", openConversationId: openConvo.id },
          { status: 409 },
        );
      }
      if (openConvo && openConvo.id === conversationId) {
        redirectConvoId = conversationId;
      } else {
        await clearLeadForceFreshInbound(tenantId, leadId);
        const reopened = await reopenConversation({
          tenantId,
          conversationId,
        });
        redirectConvoId = reopened.conversationId;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    if (message === "open_conversation_exists") {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    throw err;
  }

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return NextResponse.json({ conversationId: redirectConvoId, intent });
  }
  const path = redirectConvoId
    ? `/leads/${leadId}?c=${redirectConvoId}`
    : `/leads/${leadId}`;
  return NextResponse.redirect(redirectPath(req, path), 303);
}
