import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { CampaignActions } from "@/components/campaigns/CampaignActions";
import { CampaignEditor, type EditorInitial } from "@/components/campaigns/CampaignEditor";
import { CampaignRecipients } from "@/components/campaigns/CampaignRecipients";
import { absTime } from "@/components/crm/format";
import { parseAudience, parseParamSpecs } from "@/lib/campaigns/engine";
import { campaignSendWindow } from "@/lib/campaigns/rules";
import { campaignDetail } from "@/lib/campaigns/manage";
import { campaignPageAccess, editorData } from "@/lib/campaigns/page-data";
import { previewText } from "@/lib/campaigns/templates";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { fillUi, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

const EDITABLE = ["draft", "paused", "scheduled", "sending"];

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { tenantId } = await campaignPageAccess();
  const { id } = await params;
  const { edit } = await searchParams;
  const detail = await campaignDetail(tenantId, id);
  if (!detail) notFound();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const run = ui.campaigns.run;
  const c = detail.campaign;
  const back = (
    <p>
      <Link href="/campaigns" className="btn-ghost">
        {run.back}
      </Link>
    </p>
  );

  if (c.status === "draft" || (edit === "1" && EDITABLE.includes(c.status))) {
    const audience = parseAudience(c.audience);
    const initial: EditorInitial | null = audience
      ? {
          id: c.id,
          name: c.name,
          templateId: c.templateId,
          audience,
          params: parseParamSpecs(c.params),
          scheduledAt: c.scheduledAt?.toISOString() ?? null,
          sendWindow: c.sendWindow == null ? null : campaignSendWindow(c.sendWindow),
          followUps: c.followUps,
          sendGapMs: c.sendGapMs,
        }
      : null;
    return (
      <div>
        <PageHeader title={c.name} />
        {back}
        <CampaignEditor
          copy={run}
          lang={lang}
          data={await editorData(tenantId, lang)}
          pickedLeadIds={[]}
          initial={initial}
          live={c.status !== "draft"}
        />
        <CampaignActions id={c.id} status={c.status} copy={run} />
      </div>
    );
  }

  const m = detail.metrics;
  const status = run.statuses[c.status as keyof typeof run.statuses] ?? c.status;
  const pause = c.status === "paused" && c.pauseReason ? run.pauseReasons[c.pauseReason as keyof typeof run.pauseReasons] : "";
  const wait = (c.status === "scheduled" || c.status === "sending") && c.waitReason ? run.waitReasons[c.waitReason as keyof typeof run.waitReasons] : "";
  const audience = parseAudience(c.audience);
  const sources = audience?.kind === "clients" ? await prisma.clientSource.findMany({ where: { tenantId }, select: { id: true, label: true, kind: true } }) : [];
  const sourceLabel = (() => {
    if (audience?.kind === "leads") return fillUi(run.form.leadsPicked, { n: audience.leadIds.length });
    if (audience?.kind !== "clients") return "-";
    if (!audience.sourceId || audience.sourceId === "all") return run.form.sourceAll;
    const found = sources.find((s) => s.id === audience.sourceId);
    return found?.label || found?.kind || run.form.sourceAll;
  })();
  const total = m.sent + m.queued + m.sending + m.failed + m.skipped + m.unknown;
  const share = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const metricLabel = (key: keyof typeof m) => (key === "sending" ? run.statuses.sending : run.sendStatuses[key]);

  return (
    <div>
      <PageHeader title={c.name} />
      {back}
      <section className="card campaign-card">
        <div className="campaign-summary">
          <span className={`badge${c.status === "paused" ? " badge-warn" : ""}`}>{status}</span>
          {c.scheduledAt ? <span className="muted">{absTime(c.scheduledAt.toISOString(), lang)}</span> : null}
          {c.batchSize ? <span className="muted">{fillUi(run.detail.batchOf, { n: c.batchSize })}</span> : null}
          <span className="muted">
            {run.detail.source}: {sourceLabel}
          </span>
          <CampaignActions id={c.id} status={c.status} copy={run} />
          {EDITABLE.includes(c.status) ? (
            <Link className="btn-secondary" href={`/campaigns/${encodeURIComponent(c.id)}?edit=1`}>
              {run.cols.edit}
            </Link>
          ) : null}
        </div>
        {pause ? <p className="campaign-error">{pause}</p> : null}
        {wait ? <p className="muted">{wait}</p> : null}
      </section>

      <section className="card campaign-card">
        <h2>{run.detail.metrics}</h2>
        <p className="campaign-progress-label">
          <strong>{fillUi(run.detail.sentOf, { sent: m.sent, total })}</strong>
        </p>
        <div className="campaign-bar" role="img" aria-label={fillUi(run.detail.sentOf, { sent: m.sent, total })}>
          <span className="is-sent" style={{ width: `${share(m.sent)}%` }} />
          <span className="is-skipped" style={{ width: `${share(m.skipped)}%` }} />
          <span className="is-failed" style={{ width: `${share(m.failed)}%` }} />
        </div>
        <div className="campaign-metrics">
          {(["sent", "queued", "sending", "skipped", "failed", "unknown"] as const).map((key) => (
            <div key={key} className="campaign-metric">
              <span>{metricLabel(key)}</span>
              <b>{m[key]}</b>
            </div>
          ))}
        </div>
        {Object.keys(detail.skipReasons).length ? (
          <ul className="campaign-issues">
            {Object.entries(detail.skipReasons).map(([reason, n]) => (
              <li key={reason}>
                {run.skipReasons[reason as keyof typeof run.skipReasons] ?? reason}: {n}
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          <Link className="campaign-template-open" href="/campaigns?tab=templates">
            {c.template.title}
          </Link>
        </p>
        <div className="campaign-confirm">
          <p className="campaign-template-text">{previewText(c.template.text, [])}</p>
        </div>
      </section>

      <section className="card campaign-card">
        <h2>{run.detail.recent}</h2>
        <CampaignRecipients
          campaignId={c.id}
          lang={lang}
          rows={detail.recent.map((s) => ({
            id: s.id,
            name: s.name,
            phone: s.phone,
            status: s.status,
            skipReason: s.skipReason,
            error: s.error,
            sentAt: s.sentAt?.toISOString() ?? null,
            leadId: s.leadId,
          }))}
          labels={{ name: run.detail.filterName, status: run.detail.filterStatus, all: run.detail.filterAll, cols: run.detail.cols }}
          statusLabels={{ ...run.sendStatuses, sending: run.statuses.sending }}
          skipLabels={run.skipReasons}
          empty={run.detail.noSends}
          noMatches={run.detail.noMatches}
        />
      </section>
    </div>
  );
}
