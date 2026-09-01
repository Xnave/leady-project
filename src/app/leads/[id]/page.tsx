import Link from "next/link";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatThread } from "@/components/ChatThread";
import { FlowMap } from "@/components/FlowMap";
import { LeadFieldsForm } from "@/components/LeadFieldsForm";
import { MeetingDecisionForm } from "@/components/MeetingDecisionForm";
import { prisma } from "@/lib/db";
import type { FlowDefinition, LeadFields, LeadSchema } from "@/lib/flow/types";
import { requireTenantId } from "@/lib/tenant";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const lead = await prisma.lead.findFirst({
    where: { id, tenantId },
    include: {
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
  const convo = lead.conversations[0];
  const flow = convo?.agent.flow as FlowDefinition | undefined;
  const schema = (convo?.agent.leadSchema ?? { fields: {} }) as LeadSchema;

  return (
    <div className="demo-grid">
      <div>
        <p>
          <Link href="/leads">Leads</Link>
          {" · "}
          <Link href={`/demo?leadId=${lead.id}`}>Open in chat preview</Link>
        </p>
        <h1>{lead.displayName ?? lead.externalUserId}</h1>
        <div className="card">
          <h3>Captured data</h3>
          <LeadFieldsForm
            action={`/api/leads/${lead.id}/fields`}
            schema={schema}
            fields={(lead.fields as LeadFields) ?? {}}
            status={lead.status}
          />
        </div>
        {lead.meetings.length > 0 ? (
          <div className="card">
            <h3>Visits</h3>
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
                <MeetingDecisionForm
                  meetingId={meeting.id}
                  pending={meeting.status === "pending"}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="card chat-panel">
        <h2>Conversation</h2>
        {convo ? (
          <>
            <p className="muted">
              Stage <strong>{convo.flowState}</strong> · {convo.status}
            </p>
            <ChatThread
              messages={convo.messages.map((m) => ({
                id: m.id,
                role: m.role,
                text: m.text,
              }))}
            />
            <ChatComposer
              leadId={lead.id}
              from={lead.externalUserId}
              disabled={convo.status === "waiting_human"}
            />
          </>
        ) : (
          <p className="muted">No conversation yet.</p>
        )}
      </div>
      {flow ? (
        <div className="card">
          <h2>Flow</h2>
          <FlowMap flow={flow} current={convo?.flowState} />
        </div>
      ) : null}
    </div>
  );
}
