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
import { enrichInstagramLeadIdentity } from "@/lib/conversations";
import {
  instagramProfileUrl,
  isDemoLead,
  leadDisplayName,
  leadInstagramUsername,
} from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { convoStatusLabel } from "@/lib/ui/labels";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

function formatWhen(d: Date, lang: string) {
  return d.toLocaleString(lang === "he" ? "he-IL" : "en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
    include: {
      channel: true,
      conversations: {
        take: 1,
        orderBy: { updatedAt: "desc" },
        include: { messages: { take: 1, orderBy: { createdAt: "desc" } } },
      },
    },
  });
  let lead = leadId
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
  if (lead?.channel.provider === "instagram") {
    const changed = await enrichInstagramLeadIdentity({ leadId: lead.id, tenantId });
    if (changed) {
      lead = await prisma.lead.findFirst({
        where: { id: lead.id, tenantId },
        include: {
          channel: true,
          conversations: {
            include: { messages: { orderBy: { createdAt: "asc" } }, agent: true },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
        },
      });
    }
  }
  const convo = lead?.conversations[0];
  const schema = (agent?.leadSchema ?? { fields: {} }) as LeadSchema;
  const fields = (lead?.fields as LeadFields) ?? {};
  const igHandle = leadInstagramUsername(fields);
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
    <div>
      <p className="demo-banner">{ui.demo.banner}</p>
      <div className="demo-grid">
        <aside className="card">
          <h2>{ui.common.customers}</h2>
          <Link href="/demo" className="btn-secondary">
            {ui.common.newChat}
          </Link>
          <ul className="lead-list">
            {leads.map((item) => {
              const last = item.conversations[0]?.messages[0];
              return (
                <li key={item.id}>
                  <Link
                    href={`/demo?leadId=${item.id}`}
                    className={leadId === item.id ? "active" : undefined}
                  >
                    <div className="mailbox-item">
                      <span>
                        {leadDisplayName(item)}
                        {isDemoLead(item.externalUserId) ? (
                          <>
                            {" "}
                            <span className="badge badge-demo">{ui.common.demo}</span>
                          </>
                        ) : null}
                      </span>
                      {last ? <span className="snippet">{last.text}</span> : null}
                      <span className="meta">
                        {formatWhen(item.updatedAt, lang)}
                        {item.channel ? ` · ${ui.common.whatsapp}` : ""}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="card chat-panel">
          {lead && convo ? (
            <>
              <div className="chat-header">
                <div>
                  <h2>{leadDisplayName(lead)}</h2>
                  <p className="muted">
                    {ui.demo.simulateAs} · {convoStatusLabel(ui, convo.status)} · {catalogTitle} ·{" "}
                    {languageTitle}
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
                  {ui.chat.pausedForHuman} <Link href="/inbox">{ui.nav.inbox}</Link>
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
          {lead ? (
            <>
              <div className="card">
                <h2>{ui.common.captured}</h2>
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
            </>
          ) : (
            <div className="card demo-sidebar-agent">
              <h2>{ui.demo.agentContext}</h2>
              <p className="muted">
                {ui.chat.flowLabel}: {catalogTitle} · {ui.chat.languageLabel}: {languageTitle}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
