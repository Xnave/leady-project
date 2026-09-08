import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatThread } from "@/components/ChatThread";
import { FlowBreadcrumb } from "@/components/FlowBreadcrumb";
import { FlowMap } from "@/components/FlowMap";
import { LeadFieldsForm } from "@/components/LeadFieldsForm";
import { LeadProfilePanel } from "@/components/LeadProfilePanel";
import { MeetingDecisionForm } from "@/components/MeetingDecisionForm";
import { prisma } from "@/lib/db";
import type { FlowDefinition, LeadFields, LeadSchema } from "@/lib/flow/types";
import { getUiLang } from "@/lib/cookies";
import { enrichInstagramLeadIdentity } from "@/lib/conversations";
import {
  instagramProfileUrl,
  isDemoLead,
  leadDisplayName,
  leadInstagramUsername,
} from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
        take: 1,
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
            take: 1,
          },
          meetings: { orderBy: { createdAt: "desc" } },
        },
      });
      if (fresh) lead = fresh;
    }
  }
  const convo = lead.conversations[0];
  const flow = convo?.agent.flow as FlowDefinition | undefined;
  const schema = (convo?.agent.leadSchema ?? { fields: {} }) as LeadSchema;
  const fields = (lead.fields as LeadFields) ?? {};
  const igHandle = leadInstagramUsername(fields);

  const chatLabels = {
    placeholder: ui.chat.placeholder,
    waitingHuman: ui.chat.waitingHuman,
    send: ui.common.send,
    sending: ui.common.sending,
    sendFailed: ui.chat.sendFailed,
  };
  const threadLabels = {
    emptyThread: ui.chat.emptyThread,
    roles: ui.roles,
  };
  const meetingLabels = {
    need: ui.common.need,
    name: ui.common.name,
    phone: ui.common.phone,
    email: ui.common.email,
    approve: ui.meeting.approve,
    decline: ui.meeting.decline,
    visitDefault: ui.meeting.visitDefault,
  };

  return (
    <div className="demo-grid">
      <div className="stack">
        <p>
          <Link href="/leads">{ui.nav.leads}</Link>
          {" · "}
          <Link href={`/demo?leadId=${lead.id}`}>{ui.nav.chat}</Link>
        </p>
        <LeadProfilePanel
          lang={lang}
          ui={ui}
          leadId={lead.id}
          name={leadDisplayName(lead)}
          phone={fields.phone ? String(fields.phone) : undefined}
          email={fields.email ? String(fields.email) : undefined}
          intent={fields.intent ? String(fields.intent) : undefined}
          status={lead.status}
          stage={convo?.flowState}
          convoStatus={convo?.status}
          isDemo={isDemoLead(lead.externalUserId)}
          channel={lead.channel}
          waitingHuman={convo?.status === "waiting_human"}
          instagramHandle={igHandle || undefined}
          instagramUrl={instagramProfileUrl(igHandle) || undefined}
        />
        <div className="card">
          <h3>{ui.common.captured}</h3>
          <LeadFieldsForm
            ui={ui}
            action={`/api/leads/${lead.id}/fields`}
            schema={schema}
            fields={fields}
            status={lead.status}
            statusLabels={ui.status}
            statusLegend={ui.common.status}
            saveLabel={ui.common.save}
            enumLabels={{ intent: ui.intents }}
          />
        </div>
        {lead.meetings.length > 0 ? (
          <div className="card">
            <h3>{ui.common.visit}</h3>
            {lead.meetings.map((meeting) => (
              <div key={meeting.id} className="stage-node">
                <p>
                  <span className="badge">{meeting.status}</span>
                  {" · "}
                  {meeting.kind} · {meeting.slotText}
                </p>
                <p className="muted">
                  {meeting.contactName}
                  {meeting.contactPhone ? ` · ${meeting.contactPhone}` : ""}
                  {meeting.contactEmail ? ` · ${meeting.contactEmail}` : ""}
                </p>
                {meeting.needText ? <p className="muted">{meeting.needText}</p> : null}
                <MeetingDecisionForm
                  meetingId={meeting.id}
                  pending={meeting.status === "pending"}
                  labels={meetingLabels}
                  summary={{
                    name: meeting.contactName,
                    phone: meeting.contactPhone,
                    email: meeting.contactEmail,
                    need: meeting.needText,
                    slot: meeting.slotText,
                    kind: meeting.kind,
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="card chat-panel">
        <div className="chat-header">
          <h2>{ui.common.conversation}</h2>
          <ChannelBadge lang={lang} channel={lead.channel} />
        </div>
        {convo ? (
          <>
            <FlowBreadcrumb flow={flow!} current={convo.flowState} ui={ui} />
            <ChatThread
              messages={convo.messages.map((m) => ({
                id: m.id,
                role: m.role,
                text: m.text,
              }))}
              labels={threadLabels}
            />
            <ChatComposer
              leadId={lead.id}
              from={lead.externalUserId}
              disabled={convo.status === "waiting_human"}
              labels={chatLabels}
            />
          </>
        ) : (
          <p className="muted">{ui.common.empty}</p>
        )}
      </div>
      {flow ? (
        <div className="card">
          <h2>{ui.common.flow}</h2>
          <FlowMap flow={flow} current={convo?.flowState} labels={ui.flow} ui={ui} />
        </div>
      ) : null}
    </div>
  );
}
