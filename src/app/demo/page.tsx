import Link from "next/link";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatThread } from "@/components/ChatThread";
import { LeadFieldsForm } from "@/components/LeadFieldsForm";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { catalogMeta, isCatalogId } from "@/lib/flow/catalog";
import { chatLanguageMeta, isChatLanguage } from "@/lib/flow/locale";
import type { LeadFields, LeadSchema } from "@/lib/flow/types";
import { getUiLang } from "@/lib/cookies";
import { leadDisplayName } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
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
  });
  const lead = leadId
    ? await prisma.lead.findFirst({
        where: { id: leadId, tenantId },
        include: {
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
  const catalogId = agent?.catalogId && isCatalogId(agent.catalogId) ? agent.catalogId : "inbox";
  const catalogTitle = catalogMeta.find((c) => c.id === catalogId)?.title ?? catalogId;
  const languageId =
    tenant?.chatLanguage && isChatLanguage(tenant.chatLanguage) ? tenant.chatLanguage : "multi";
  const languageTitle = chatLanguageMeta.find((c) => c.id === languageId)?.title ?? languageId;
  const setupIncomplete = !(tenant?.intro ?? "").trim();

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
              <Link href={`/demo?leadId=${item.id}`}>{leadDisplayName(item)}</Link>
            </li>
          ))}
        </ul>
      </aside>
      <section className="card chat-panel">
        <PageHeader title={tenant?.name ?? ui.page.chatTitle} />
        {setupIncomplete ? (
          <p className="muted">
            <Link href="/onboard">{ui.nav.setup}</Link>
          </p>
        ) : null}
        {lead && convo ? (
          <>
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
            {convo.status === "waiting_human" ? (
              <p className="muted">
                <Link href="/inbox">{ui.nav.inbox}</Link>
              </p>
            ) : null}
          </>
        ) : (
          <ChatComposer />
        )}
      </section>
      <aside>
        <div className="card">
          <h2>{tenant?.name}</h2>
          <p className="muted">{tenant?.intro || ui.common.empty}</p>
          <p className="muted">
            {ui.common.flow}: {catalogTitle}
          </p>
          <p className="muted">{languageTitle}</p>
        </div>
        {lead ? (
          <div className="card">
            <h2>{ui.common.captured}</h2>
            <LeadFieldsForm
              action={`/api/leads/${lead.id}/fields`}
              schema={schema}
              fields={(lead.fields as LeadFields) ?? {}}
              status={lead.status}
              statusLabels={ui.status}
              saveLabel={ui.common.save}
            />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
