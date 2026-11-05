import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { CampaignActions } from "@/components/campaigns/CampaignActions";
import { CampaignEditor, type EditorInitial } from "@/components/campaigns/CampaignEditor";
import { absTime } from "@/components/crm/format";
import { parseAudience, parseParamSpecs } from "@/lib/campaigns/engine";
import { campaignDetail } from "@/lib/campaigns/manage";
import { campaignPageAccess, editorData } from "@/lib/campaigns/page-data";
import { previewText } from "@/lib/campaigns/templates";
import { getUiLang } from "@/lib/cookies";
import { formatPhoneDisplay } from "@/lib/leads";
import { fillUi, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await campaignPageAccess();
  const { id } = await params;
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

  if (c.status === "draft") {
    const audience = parseAudience(c.audience);
    const initial: EditorInitial | null = audience
      ? {
          id: c.id,
          name: c.name,
          templateId: c.templateId,
          audience,
          params: parseParamSpecs(c.params),
          goal: c.goal === "book" ? "book" : "handoff",
          brief: c.brief,
          batchSize: c.batchSize,
          scheduledAt: c.scheduledAt?.toISOString() ?? null,
        }
      : null;
    return (
      <div>
        <PageHeader title={c.name} />
        {back}
        <CampaignEditor
          copy={run}
          confidenceNames={ui.clientSources.confidence}
          lang={lang}
          data={await editorData(tenantId)}
          pickedLeadIds={[]}
          initial={initial}
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

  return (
    <div>
      <PageHeader title={c.name} blurb={c.template.title} />
      {back}
      <section className="card campaign-card">
        <p>
          <span className={`badge${c.status === "paused" ? " badge-warn" : ""}`}>{status}</span>
          {c.scheduledAt ? <span className="muted"> · {absTime(c.scheduledAt.toISOString(), lang)}</span> : null}
          {c.batchSize ? <span className="muted"> · {fillUi(run.detail.batchOf, { n: c.batchSize })}</span> : null}
        </p>
        {pause ? <p className="campaign-error">{pause}</p> : null}
        {wait ? <p className="muted">{wait}</p> : null}
        <CampaignActions id={c.id} status={c.status} copy={run} />
        <dl className="campaign-admin-facts">
          <dt>{run.detail.goal}</dt>
          <dd>{run.form.goals[c.goal === "book" ? "book" : "handoff"]}</dd>
          <dt>{run.detail.audience}</dt>
          <dd>
            {audience?.kind === "leads"
              ? fillUi(run.form.leadsPicked, { n: audience.leadIds.length })
              : audience?.kind === "clients"
                ? `${run.form.audienceClients}${audience.dealYearsAgoMin != null || audience.dealYearsAgoMax != null ? ` · ${audience.dealYearsAgoMin ?? 0}-${audience.dealYearsAgoMax ?? "∞"}` : ""}`
                : "-"}
          </dd>
          {c.declaration ? (
            <>
              <dt>{run.detail.declaredBy}</dt>
              <dd>
                {c.declaration.actorLabel} · {absTime(c.declaration.createdAt.toISOString(), lang)} · v{c.declaration.textVersion}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="card campaign-card">
        <h2>{run.detail.metrics}</h2>
        <dl className="campaign-admin-facts">
          {(["sent", "queued", "sending", "failed", "skipped"] as const).map((k) => (
            <span key={k} className="client-source-stat">
              <dt>{run.sendStatuses[k]}</dt>
              <dd>{m[k]}</dd>
            </span>
          ))}
          {Object.entries(detail.skipReasons).map(([reason, n]) => (
            <span key={reason} className="client-source-stat">
              <dt>· {run.skipReasons[reason as keyof typeof run.skipReasons] ?? reason}</dt>
              <dd>{n}</dd>
            </span>
          ))}
        </dl>
        <div className="campaign-confirm">
          <p className="campaign-template-text">{previewText(c.template.text, [])}</p>
        </div>
      </section>

      <section className="card campaign-card">
        <h2>{run.detail.recent}</h2>
        {detail.recent.length === 0 ? (
          <p className="muted">{run.detail.noSends}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {detail.recent.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.leadId ? <Link href={`/leads/${encodeURIComponent(s.leadId)}`}>{s.name || "-"}</Link> : s.name || "-"}
                    </td>
                    <td dir="ltr" className="muted">
                      {s.phone.startsWith("none:") ? "-" : formatPhoneDisplay(s.phone)}
                    </td>
                    <td>
                      {run.sendStatuses[s.status as keyof typeof run.sendStatuses] ?? s.status}
                      {s.skipReason ? ` · ${run.skipReasons[s.skipReason as keyof typeof run.skipReasons] ?? s.skipReason}` : ""}
                      {s.status === "failed" && s.error ? <span className="muted"> · {s.error.slice(0, 80)}</span> : null}
                    </td>
                    <td className="muted">{s.sentAt ? absTime(s.sentAt.toISOString(), lang) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
