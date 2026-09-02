import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatThread } from "@/components/ChatThread";
import { FlowBreadcrumb } from "@/components/FlowBreadcrumb";
import { LeadFieldsForm } from "@/components/LeadFieldsForm";
import { LeadProfilePanel } from "@/components/LeadProfilePanel";
import { prisma } from "@/lib/db";
import { flowForCatalog, isCatalogId } from "@/lib/flow/catalog";
import { isChatLanguage } from "@/lib/flow/locale";
import type { FlowDefinition, LeadFields, LeadSchema } from "@/lib/flow/types";
import { getUiLang } from "@/lib/cookies";
import { isDemoLead, leadDisplayName } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { convoStatusLabel } from "@/lib/ui/labels";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const { leadId } = await searchParams;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  const agent = await prisma.agent.findFirst({ where: { tenantId } });
  const leads = await prisma.lead.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    take: 30,
    include: { channel: true },
  });
  const lead = leadId
    ? await prisma.lead.findFirst({
        where: { id: leadId, tenantId },
        include: {
          channel: true,
          conversations: {
            include: { messages: { orderBy: { createdAt: "asc" } }, agent: true },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
        },
      })
    : null;
  const convo = lead?.conversations[0];
  const schema = (agent?.leadSchema ?? { fields: {} }) as LeadSchema;
  const fields = (lead?.fields as LeadFields) ?? {};
  const catalogId = agent?.catalogId && isCatalogId(agent.catalogId) ? agent.catalogId : "inbox";
  const catalogTitle = ui.catalog[catalogId]?.title ?? catalogId;
  const languageId =
    tenant?.chatLanguage && isChatLanguage(tenant.chatLanguage) ? tenant.chatLanguage : "multi";
  const languageTitle = ui.chatLanguage[languageId]?.title ?? languageId;
  const setupIncomplete = !(tenant?.intro ?? "").trim();
  const flow = flowForCatalog(catalogId) as FlowDefinition;
  const agentFlow = (convo?.agent.flow ?? flow) as FlowDefinition;

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

  return (
    <div className="demo-grid">
      <aside className="card">
        <h2>{ui.common.customers}</h2>
        <Link href="/demo" className="btn-secondary">
          {ui.common.newChat}
        </Link>
        <ul className="lead-list">
          {leads.map((item) => (
            <li key={item.id}>
              <Link
                href={`/demo?leadId=${item.id}`}
                className={leadId === item.id ? "active" : undefined}
              >
                {leadDisplayName(item)}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="card chat-panel">
        {lead && convo ? (
          <>
            <div className="chat-header">
              <div>
                <h2>{leadDisplayName(lead)}</h2>
                <p className="muted">
                  {ui.demo.simulateAs} · {convoStatusLabel(ui, convo.status)}
                </p>
              </div>
              <ChannelBadge lang={lang} channel={lead.channel} />
            </div>
            <FlowBreadcrumb flow={agentFlow} current={convo.flowState} ui={ui} />
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
            {convo.status === "waiting_human" ? (
              <p className="muted">
                {ui.chat.pausedForHuman}{" "}
                <Link href="/inbox">{ui.nav.inbox}</Link>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="chat-header">
              <h2>{tenant?.name ?? ui.page.chatTitle}</h2>
            </div>
            {setupIncomplete ? (
              <p className="muted">
                <Link href="/onboard">{ui.nav.setup}</Link>
              </p>
            ) : null}
            <p className="muted">{ui.demo.noLeadSelected}</p>
            <ChatComposer labels={chatLabels} />
          </>
        )}
      </section>

      <aside className="stack">
        <div className="card demo-sidebar-agent">
          <h2>{ui.demo.agentContext}</h2>
          <p className="muted">{tenant?.intro || ui.chat.noIntro}</p>
          <p className="muted">
            {ui.chat.flowLabel}: {catalogTitle}
          </p>
          <p className="muted">
            {ui.chat.languageLabel}: {languageTitle}
          </p>
        </div>
        {lead ? (
          <>
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
              flow={agentFlow}
              waitingHuman={convo?.status === "waiting_human"}
            />
            <div className="card">
              <h2>{ui.common.captured}</h2>
              <LeadFieldsForm
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
          </>
        ) : null}
      </aside>
    </div>
  );
}
