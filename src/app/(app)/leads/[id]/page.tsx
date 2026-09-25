import { LeadWorkspace } from "@/components/LeadWorkspace";
import { LeadPage } from "@/components/crm/LeadPage";
import { prisma } from "@/lib/db";
import type { FlowDefinition, LeadFields, LeadSchema } from "@/lib/flow/types";
import { getUiLang } from "@/lib/cookies";
import { enrichInstagramLeadIdentity } from "@/lib/conversations";
import { crmV2Enabled } from "@/lib/crm/flags";
import { loadLeadView } from "@/lib/crm/view";
import { loadWonLabel } from "@/lib/crm/won-label";
import {
  instagramProfileUrl,
  isDemoLead,
  leadDisplayName,
  leadInstagramUsername,
  whatsappChatUrl,
} from "@/lib/leads";
import { requireTenantIdForPage } from "@/lib/tenant";
import { loadInstanceFieldLabels } from "@/lib/capability-instances";
import type { RequestRow } from "@/lib/requests";
import {
  requestHeadline,
  requestSummaryLines,
  requestTimeDisplay,
  requestTimeShape,
} from "@/lib/request-view";
import { uiCopy } from "@/lib/ui";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { id } = await params;
  const { c: convoParam } = await searchParams;
  const tenantId = await requireTenantIdForPage();
  const lang = await getUiLang();
  const ui = uiCopy(lang);

  const tenantFlags = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { crmV2: true } });
  if (crmV2Enabled(tenantFlags)) {
    const dto = await loadLeadView(tenantId, id, ui, lang);
    if (!dto) notFound();
    if (dto.unread) {
      await prisma.lead.updateMany({ where: { id, tenantId }, data: { adminUnread: false } });
    }
    const wonLabel = await loadWonLabel(tenantId, ui);
    return <LeadPage dto={dto} ui={ui} lang={lang} wonLabel={wonLabel} />;
  }

  const instanceLabels = await loadInstanceFieldLabels(tenantId);
  const requestFieldLabels: Record<string, string> = {
    need: ui.common.need,
    name: ui.common.name,
    phone: ui.common.phone,
    email: ui.common.email,
    guests: ui.reservation.guests,
    unit: ui.reservation.unit,
    ...instanceLabels,
  };
  let lead = await prisma.lead.findFirst({
    where: { id, tenantId },
    include: {
      channel: true,
      conversations: {
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          agent: true,
        },
        orderBy: { createdAt: "desc" },
      },
      requests: { orderBy: { createdAt: "desc" } },
      adminDecisionLogs: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) notFound();
  if (lead.channel.provider === "instagram") {
    const changed = await enrichInstagramLeadIdentity({ leadId: lead.id, tenantId });
    if (changed) {
      const fresh = await prisma.lead.findFirst({
        where: { id, tenantId },
        include: {
          channel: true,
          conversations: {
            include: {
              messages: { orderBy: { createdAt: "asc" } },
              agent: true,
            },
            orderBy: { createdAt: "desc" },
          },
          requests: { orderBy: { createdAt: "desc" } },
          adminDecisionLogs: { orderBy: { createdAt: "desc" } },
        },
      });
      if (fresh) lead = fresh;
    }
  }
  const conversations = lead.conversations;
  const lastActivityAt = (c: (typeof conversations)[number]) => {
    const lastMsg = c.messages[c.messages.length - 1];
    return lastMsg?.createdAt?.getTime() ?? c.updatedAt.getTime();
  };
  // Keep open (incl. empty new) threads visible so staff can write after "start".
  const visibleConversations = [...conversations]
    .filter(
      (c) =>
        c.messages.length > 0 ||
        c.status !== "closed" ||
        c.id === convoParam,
    )
    .sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
  const convo =
    visibleConversations.find((c) => c.id === convoParam) ??
    conversations.find((c) => c.id === convoParam) ??
    visibleConversations[0];
  const flow = convo?.agent.flow as FlowDefinition | undefined;
  const schema = (convo?.agent.leadSchema ?? { fields: {} }) as LeadSchema;
  const crmFields = (lead.fields as LeadFields) ?? {};
  const sessionFields = (convo?.session as LeadFields) ?? {};
  const fields = { ...crmFields, ...sessionFields };
  const staffOffer =
    fields.staff_slot_offer && typeof fields.staff_slot_offer === "object"
      ? (fields.staff_slot_offer as { meetingId?: string })
      : null;
  const igHandle =
    lead.channel.provider === "instagram" ? leadInstagramUsername(fields) : "";
  const phone =
    (typeof fields.phone === "string" && fields.phone) ||
    (lead.channel.provider === "whatsapp" ? lead.externalUserId : "") ||
    "";
  const waUrl = lead.channel.provider === "whatsapp" ? whatsappChatUrl(phone) : "";
  const latestByCreated = [...conversations].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  const latestId = latestByCreated?.id;
  const isLatest = Boolean(convo && latestId && convo.id === latestId);
  const hasOpenConversation = conversations.some((c) => c.status !== "closed");

  if (lead.adminUnread) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { adminUnread: false },
    });
  }

  return (
    <LeadWorkspace
      lang={lang}
      ui={ui}
      leadId={lead.id}
      name={leadDisplayName(lead)}
      phone={phone || undefined}
      email={typeof fields.email === "string" ? fields.email : undefined}
      intent={typeof fields.intent === "string" ? fields.intent : undefined}
      status={lead.status}
      stage={convo?.flowState}
      convoStatus={convo?.status}
      isDemo={isDemoLead(lead.externalUserId)}
      channel={lead.channel}
      waitingHuman={convo?.status === "waiting_human"}
      instagramHandle={igHandle || undefined}
      instagramUrl={instagramProfileUrl(igHandle) || undefined}
      whatsappUrl={waUrl || undefined}
      whatsappLabel={phone || undefined}
      showOpenFullLead={false}
      conversations={visibleConversations.map((c) => ({
        id: c.id,
        status: c.status,
        flowState: c.flowState,
        summary: c.summary,
        updatedAt: c.updatedAt,
        lastAt: c.messages[c.messages.length - 1]?.createdAt ?? c.updatedAt,
        messageCount: c.messages.length,
      }))}
      activeConversationId={convo?.id}
      conversationId={convo?.id}
      isLatestConversation={isLatest}
      hasOpenConversation={hasOpenConversation}
      latestConversationId={latestId}
      flow={flow}
      messages={(convo?.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: m.createdAt,
      }))}
      summary={convo?.summary}
      composerFrom={lead.externalUserId}
      composerDisabled={!convo || convo.status === "closed"}
      schema={schema}
      fields={fields}
      requests={lead.requests.map((row) => {
        const request = {
          ...row,
          data: (row.data && typeof row.data === "object"
            ? (row.data as Record<string, unknown>)
            : {}) as RequestRow["data"],
        };
        return {
          id: request.id,
          capabilityId: request.capabilityId,
          status: request.status,
          timeText: requestTimeDisplay(request),
          timeShape: requestTimeShape(request),
          headline: requestHeadline(request),
          contactName: request.contactName,
          contactPhone: request.contactPhone,
          lines: requestSummaryLines({ request, lang, labels: requestFieldLabels }),
          conversationId: request.conversationId,
          awaitingCustomerConfirm: staffOffer?.meetingId === request.id,
          customerConfirmed:
            request.status === "approved" && request.decidedBy === "customer",
        };
      })}
      decisionLogs={lead.adminDecisionLogs.map((row) => ({
        id: row.id,
        category: row.category,
        action: row.action,
        actorUserId: row.actorUserId,
        actorLabel: row.actorLabel,
        summary: row.summary,
        details:
          row.details && typeof row.details === "object" && !Array.isArray(row.details)
            ? (row.details as Record<string, unknown>)
            : {},
        createdAt: row.createdAt,
      }))}
      requestLabels={{
        approve: ui.meeting.approve,
        decline: ui.meeting.decline,
        reschedule: ui.meeting.reschedule,
        alternativeSlotLabel: ui.meeting.alternativeSlotLabel,
        alternativeSlotPlaceholder: ui.meeting.alternativeSlotPlaceholder,
        alternativeStartLabel: ui.reservation.alternativeCheckInLabel,
        alternativeEndLabel: ui.reservation.alternativeCheckOutLabel,
        noteLabel: ui.inbox.declineNoteLabel,
        notePlaceholder: ui.inbox.declineNotePlaceholder,
        customReplyLabel: ui.inbox.customReplyLabel,
        customReplyPlaceholder: ui.inbox.customReplyPlaceholder,
        currentStatus: ui.inbox.currentDecision,
        changeDecision: ui.inbox.changeDecision,
        cancel: ui.common.cancel,
      }}
      chatLabels={{
        placeholder: ui.inbox.staffPlaceholder,
        waitingHuman: ui.chat.waitingHuman,
        send: ui.common.send,
        sending: ui.common.sending,
        sendFailed: ui.chat.sendFailed,
      }}
      threadLabels={{
        emptyThread: ui.chat.emptyThread,
        roles: ui.roles,
        today: ui.chat.today,
        yesterday: ui.chat.yesterday,
      }}
    />
  );
}
