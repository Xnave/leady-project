import Link from "next/link";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatThread } from "@/components/ChatThread";
import { LeadFieldsForm } from "@/components/LeadFieldsForm";
import { prisma } from "@/lib/db";
import { catalogMeta, isCatalogId } from "@/lib/flow/catalog";
import { chatLanguageMeta, isChatLanguage } from "@/lib/flow/locale";
import type { LeadFields, LeadSchema } from "@/lib/flow/types";
import { llmConfigured } from "@/lib/flow/model";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const { leadId } = await searchParams;
  const tenantId = await requireTenantId();
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
  const languageId = tenant?.chatLanguage && isChatLanguage(tenant.chatLanguage)
    ? tenant.chatLanguage
    : "multi";
  const languageTitle = chatLanguageMeta.find((c) => c.id === languageId)?.title ?? languageId;
  const setupIncomplete = !(tenant?.intro ?? "").trim();

  return (
    <div className="demo-grid">
      <aside className="card">
        <h2>Customers</h2>
        <p className="muted">Same person keeps the same thread and flow state.</p>
        <Link href="/demo" className="btn-secondary">
          New chat
        </Link>
        <ul className="lead-list">
          {leads.map((item) => (
            <li key={item.id}>
              <Link href={`/demo?leadId=${item.id}`}>
                {item.displayName ?? item.externalUserId}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <section className="card chat-panel">
        <h1>{tenant?.name ?? "Chat preview"}</h1>
        <p className="muted">
          You are chatting as a customer of {tenant?.name ?? "this business"}.
          {llmConfigured()
            ? " Replies use OpenAI."
            : " Heuristic fallback — save `.env` with OPENAI_API_KEY on disk (Cmd+S), then restart `npm run dev`."}
        </p>
        {setupIncomplete ? (
          <p className="muted">
            Add a business intro in <Link href="/onboard">Setup</Link> so the agent can greet properly.
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
                Paused for a human. Finish the task in <Link href="/inbox">Inbox</Link>.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="muted">Start as a new customer (or pick one on the left).</p>
            <ChatComposer />
          </>
        )}
      </section>
      <aside>
        <div className="card">
          <h2>{tenant?.name}</h2>
          <p className="muted">{tenant?.intro || "No intro yet."}</p>
          <p className="muted">Flow: {catalogTitle}</p>
          <p className="muted">Language: {languageTitle}</p>
        </div>
        {lead ? (
          <div className="card">
            <h2>Captured data</h2>
            <LeadFieldsForm
              action={`/api/leads/${lead.id}/fields`}
              schema={schema}
              fields={(lead.fields as LeadFields) ?? {}}
              status={lead.status}
            />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
