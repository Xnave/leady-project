import { LeadWorkspace } from "@/components/LeadWorkspace";
import { prisma } from "@/lib/db";
import type { FlowDefinition, LeadFields, LeadSchema } from "@/lib/flow/types";
import { getUiLang } from "@/lib/cookies";
import { enrichInstagramLeadIdentity } from "@/lib/conversations";
import {
  instagramProfileUrl,
  isDemoLead,
  leadDisplayName,
  leadInstagramUsername,
  whatsappChatUrl,
} from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
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
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
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
      meetings: { orderBy: { createdAt: "desc" } },
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
          meetings: { orderBy: { createdAt: "desc" } },
        },
      });
      if (fresh) lead = fresh;
    }
  }
  const conversations = lead.conversations;
  const withMessages = conversations.filter((c) => c.messages.length > 0);
  const lastActivityAt = (c: (typeof conversations)[number]) => {
    const lastMsg = c.messages[c.messages.length - 1];
    return lastMsg?.createdAt?.getTime() ?? c.updatedAt.getTime();
  };
  const visibleConversations = [...(withMessages.length > 0 ? withMessages : conversations)].sort(
    (a, b) => lastActivityAt(b) - lastActivityAt(a),
  );
  const convo =
    visibleConversations.find((c) => c.id === convoParam) ?? visibleConversations[0];
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
  const latestId = visibleConversations[0]?.id;
  const isLatest = Boolean(convo && latestId && convo.id === latestId);

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
      meetings={lead.meetings.map((m) => ({
        id: m.id,
        status: m.status,
        kind: m.kind,
        slotText: m.slotText,
        contactName: m.contactName,
        contactPhone: m.contactPhone,
        contactEmail: m.contactEmail,
        needText: m.needText,
        conversationId: m.conversationId,
        awaitingCustomerConfirm: staffOffer?.meetingId === m.id,
        customerConfirmed: m.status === "approved" && m.decidedBy === "customer",
      }))}
      meetingLabels={{
        need: ui.common.need,
        name: ui.common.name,
        phone: ui.common.phone,
        email: ui.common.email,
        approve: ui.meeting.approve,
        decline: ui.meeting.decline,
        reschedule: ui.meeting.reschedule,
        alternativeSlotLabel: ui.meeting.alternativeSlotLabel,
        alternativeSlotPlaceholder: ui.meeting.alternativeSlotPlaceholder,
        visitDefault: ui.meeting.visitDefault,
        noteLabel: ui.inbox.declineNoteLabel,
        notePlaceholder: ui.inbox.declineNotePlaceholder,
        customReplyLabel: ui.inbox.customReplyLabel,
        customReplyPlaceholder: ui.inbox.customReplyPlaceholder,
        updateDecision: ui.inbox.updateDecision,
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
