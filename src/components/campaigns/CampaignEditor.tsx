"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import type { EditorTemplate } from "@/lib/campaigns/page-data";
import type { Audience, ParamSpec } from "@/lib/campaigns/rules";
import { DECLARATION_VERSION, PARAM_SOURCES } from "@/lib/campaigns/rules";
import { previewText } from "@/lib/campaigns/templates";
import { fillUi, type UiCopy, type UiLang } from "@/lib/ui";

type Copy = UiCopy["campaigns"]["run"];
type Confidence = "high" | "medium_high" | "medium" | "low";
const CONFIDENCES: Confidence[] = ["high", "medium_high", "medium", "low"];

export type EditorInitial = {
  id: string;
  name: string;
  templateId: string;
  audience: Audience;
  params: ParamSpec[];
  goal: "handoff" | "book";
  brief: string;
  batchSize: number | null;
  scheduledAt: string | null;
};

type Preview = { total: number; eligible: number; skipped: Record<string, number>; sample: string[]; costUsd: number };

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

export function CampaignEditor({
  copy,
  confidenceNames,
  lang,
  data,
  pickedLeadIds,
  initial,
}: {
  copy: Copy;
  confidenceNames: Record<Confidence, string>;
  lang: UiLang;
  data: { templates: EditorTemplate[]; hasClientSource: boolean; businessName: string; whatsappPhone: string | null };
  pickedLeadIds: string[];
  initial: EditorInitial | null;
}) {
  const router = useRouter();
  const f = copy.form;
  const initialLeads = initial?.audience.kind === "leads" ? initial.audience.leadIds : pickedLeadIds;
  const initialClients = initial?.audience.kind === "clients" ? initial.audience : null;

  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [templateId, setTemplateId] = useState(initial?.templateId ?? data.templates[0]?.id ?? "");
  const [audienceKind, setAudienceKind] = useState<"clients" | "leads">(initialLeads.length ? "leads" : "clients");
  const [yearsMin, setYearsMin] = useState(initialClients?.dealYearsAgoMin?.toString() ?? "");
  const [yearsMax, setYearsMax] = useState(initialClients?.dealYearsAgoMax?.toString() ?? "");
  const [confidence, setConfidence] = useState<Confidence[]>(initialClients?.confidence ?? []);
  const [includeNoDate, setIncludeNoDate] = useState(initialClients?.includeNoDealDate ?? false);
  const [params, setParams] = useState<ParamSpec[]>(initial?.params ?? []);
  const [goal, setGoal] = useState<"handoff" | "book">(initial?.goal ?? "handoff");
  const [brief, setBrief] = useState(initial?.brief ?? "");
  const [batch, setBatch] = useState(initial?.batchSize?.toString() ?? "");
  const [schedule, setSchedule] = useState(toLocalInput(initial?.scheduledAt ?? null));
  const [busy, setBusy] = useState<"" | "save" | "check" | "confirm">("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [declared, setDeclared] = useState(false);
  const [dirty, setDirty] = useState(!initial);

  const template = data.templates.find((t) => t.id === templateId);
  const paramCount = template?.paramCount ?? 0;
  const specs: ParamSpec[] = useMemo(
    () => Array.from({ length: paramCount }, (_, i) => params[i] ?? { source: i === 0 ? "first_name" : "business_name", value: "", fallback: "" }),
    [params, paramCount],
  );

  const touch = () => {
    setDirty(true);
    setPreview(null);
    setDeclared(false);
  };

  function setSpec(i: number, patch: Partial<ParamSpec>) {
    const next = [...specs];
    next[i] = { ...next[i], ...patch };
    setParams(next);
    touch();
  }

  function errorText(code: string | undefined): string {
    const key = (code ?? "failed") as keyof Copy["errors"];
    return copy.errors[key] ?? copy.errors.failed;
  }

  function body() {
    const audience: Audience =
      audienceKind === "leads"
        ? { kind: "leads", leadIds: initialLeads }
        : { kind: "clients", dealYearsAgoMin: numOrNull(yearsMin), dealYearsAgoMax: numOrNull(yearsMax), confidence, includeNoDealDate: includeNoDate };
    return {
      name,
      templateId,
      audience,
      params: specs,
      goal,
      brief,
      batchSize: numOrNull(batch),
      scheduledAt: schedule ? new Date(schedule).toISOString() : null,
    };
  }

  async function save(e?: FormEvent): Promise<string | null> {
    e?.preventDefault();
    setBusy("save");
    setMessage(null);
    try {
      const res = await fetch(id ? `/api/campaigns/runs/${encodeURIComponent(id)}` : "/api/campaigns/runs", {
        method: id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      const out = (await res.json().catch(() => ({}))) as { id?: string; error?: string; detail?: string };
      if (!res.ok) {
        setMessage({ ok: false, text: errorText(out.error) + (out.detail ? ` (${out.detail})` : "") });
        return null;
      }
      const savedId = id || out.id || "";
      setDirty(false);
      setMessage({ ok: true, text: f.saved });
      if (!id && savedId) {
        setId(savedId);
        router.replace(`/campaigns/${encodeURIComponent(savedId)}`);
      }
      return savedId;
    } catch {
      setMessage({ ok: false, text: copy.errors.failed });
      return null;
    } finally {
      setBusy("");
    }
  }

  async function check() {
    const savedId = dirty ? await save() : id;
    if (!savedId) return;
    setBusy("check");
    try {
      const res = await fetch(`/api/campaigns/runs/${encodeURIComponent(savedId)}/preview`, { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as Preview & { error?: string };
      if (!res.ok) setMessage({ ok: false, text: errorText(out.error) });
      else setPreview(out);
    } finally {
      setBusy("");
    }
  }

  async function confirm() {
    if (!id || !declared) return;
    setBusy("confirm");
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/runs/${encodeURIComponent(id)}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ declarationAccepted: true, declarationVersion: DECLARATION_VERSION, language: lang }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage({ ok: false, text: errorText(out.error) });
        return;
      }
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  const sampleName = preview?.sample[0] ?? "";
  const previewValues = specs.map((s, i) => {
    if (s.source === "first_name") return sampleName.split(/\s+/)[0] || s.fallback || template?.examples[i] || "";
    if (s.source === "full_name") return sampleName || s.fallback || template?.examples[i] || "";
    if (s.source === "business_name") return data.businessName;
    return s.value;
  });

  if (!data.templates.length) return <p className="muted">{f.noApproved}</p>;

  return (
    <div className="campaign-page">
      <form className="card campaign-card" onSubmit={(e) => void save(e)}>
        <label>
          {f.name}
          <input value={name} maxLength={80} required onChange={(e) => (setName(e.target.value), touch())} />
        </label>
        <label>
          {f.template}
          <select value={templateId} onChange={(e) => (setTemplateId(e.target.value), setParams([]), touch())}>
            {data.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>{f.audience}</legend>
          <label className="choice">
            <input type="radio" checked={audienceKind === "clients"} disabled={!data.hasClientSource} onChange={() => (setAudienceKind("clients"), touch())} />
            {f.audienceClients}
          </label>
          {!data.hasClientSource ? <p className="muted campaign-hint">{f.noClientSource}</p> : null}
          {initialLeads.length ? (
            <label className="choice">
              <input type="radio" checked={audienceKind === "leads"} onChange={() => (setAudienceKind("leads"), touch())} />
              {f.audienceLeads} · {fillUi(f.leadsPicked, { n: initialLeads.length })}
            </label>
          ) : null}
          {audienceKind === "clients" && data.hasClientSource ? (
            <>
              <div className="campaign-row">
                <label>
                  {f.yearsMin}
                  <input type="number" min={0} max={60} step={0.5} value={yearsMin} onChange={(e) => (setYearsMin(e.target.value), touch())} />
                </label>
                <label>
                  {f.yearsMax}
                  <input type="number" min={0} max={60} step={0.5} value={yearsMax} onChange={(e) => (setYearsMax(e.target.value), touch())} />
                </label>
              </div>
              <p className="muted campaign-hint">{f.yearsHint}</p>
              <p className="campaign-hint">{f.confidence}</p>
              <div className="campaign-checks">
                {CONFIDENCES.map((c) => (
                  <label key={c} className="choice">
                    <input
                      type="checkbox"
                      checked={confidence.includes(c)}
                      onChange={(e) => (setConfidence(e.target.checked ? [...confidence, c] : confidence.filter((x) => x !== c)), touch())}
                    />
                    {confidenceNames[c]}
                  </label>
                ))}
              </div>
              <p className="muted campaign-hint">{f.confidenceHint}</p>
              {yearsMin === "" && yearsMax === "" ? (
                <label className="choice">
                  <input type="checkbox" checked={includeNoDate} onChange={(e) => (setIncludeNoDate(e.target.checked), touch())} />
                  {f.includeNoDate}
                </label>
              ) : null}
            </>
          ) : null}
        </fieldset>

        {paramCount > 0 ? (
          <fieldset>
            <legend>{f.params}</legend>
            {specs.map((s, i) => (
              <div key={i} className="campaign-row">
                <label>
                  {fillUi(f.paramLabel, { n: i + 1 })}
                  <select value={s.source} onChange={(e) => setSpec(i, { source: e.target.value as ParamSpec["source"] })}>
                    {PARAM_SOURCES.map((src) => (
                      <option key={src} value={src}>
                        {f.paramSources[src]}
                      </option>
                    ))}
                  </select>
                </label>
                {s.source === "text" ? (
                  <label>
                    {f.paramValue}
                    <input value={s.value} maxLength={200} onChange={(e) => setSpec(i, { value: e.target.value })} />
                  </label>
                ) : s.source !== "business_name" ? (
                  <label>
                    {f.paramFallback}
                    <input value={s.fallback} maxLength={200} onChange={(e) => setSpec(i, { fallback: e.target.value })} />
                  </label>
                ) : null}
              </div>
            ))}
          </fieldset>
        ) : null}

        <label>
          {f.goal}
          <select value={goal} onChange={(e) => (setGoal(e.target.value as "handoff" | "book"), touch())}>
            <option value="handoff">{f.goals.handoff}</option>
            <option value="book">{f.goals.book}</option>
          </select>
        </label>
        <label>
          {f.brief}
          <textarea rows={3} maxLength={2000} value={brief} onChange={(e) => (setBrief(e.target.value), touch())} />
        </label>
        <p className="muted campaign-hint">{f.briefHint}</p>
        <div className="campaign-row">
          <label>
            {f.batch}
            <input type="number" min={1} step={1} value={batch} onChange={(e) => (setBatch(e.target.value), touch())} />
          </label>
          <label>
            {f.schedule}
            <input type="datetime-local" value={schedule} onChange={(e) => (setSchedule(e.target.value), touch())} />
          </label>
        </div>
        <p className="muted campaign-hint">
          {f.batchHint} {f.scheduleHint}
        </p>
        {message ? <p className={message.ok ? "muted" : "campaign-error"}>{message.text}</p> : null}
        <div className="field-form-actions">
          <button type="submit" className="btn-secondary" disabled={busy !== ""} aria-busy={busy === "save"}>
            {busy === "save" ? f.saving : f.saveDraft}
          </button>
        </div>
      </form>

      {id ? (
        <section className="card campaign-card">
          <h2>{copy.confirm.title}</h2>
          <button type="button" className="btn-secondary" disabled={busy !== ""} onClick={() => void check()}>
            {busy === "check" ? copy.confirm.checking : copy.confirm.check}
          </button>
          {preview ? (
            <>
              <p>
                <strong>
                  {preview.eligible === preview.total
                    ? fillUi(copy.confirm.recipients, { n: preview.eligible })
                    : fillUi(copy.confirm.recipientsOf, { n: preview.eligible, total: preview.total })}
                </strong>
              </p>
              {Object.keys(preview.skipped).length ? (
                <div>
                  <p className="campaign-hint">{copy.confirm.skippedTitle}</p>
                  <ul className="campaign-issues">
                    {Object.entries(preview.skipped).map(([reason, n]) => (
                      <li key={reason}>
                        {copy.skipReasons[reason as keyof Copy["skipReasons"]] ?? reason}: {n}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preview.sample.length ? (
                <p className="muted">
                  {copy.confirm.sample}: {preview.sample.join(", ")}
                </p>
              ) : null}
              <p>{fillUi(copy.confirm.cost, { usd: preview.costUsd.toFixed(2) })}</p>
              <p className="muted campaign-hint">{copy.confirm.costHint}</p>
              {template ? (
                <div className="campaign-confirm">
                  <p className="campaign-hint">
                    {copy.confirm.preview}
                    {data.whatsappPhone ? ` · ${data.whatsappPhone}` : ""}
                  </p>
                  <p className="campaign-template-text">{previewText(template.text, previewValues)}</p>
                </div>
              ) : null}
              <p className="muted campaign-hint">{copy.confirm.rulesNote}</p>
              <label className="choice campaign-declaration">
                <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
                {copy.declaration}
              </label>
              <div className="field-form-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy !== "" || !declared || preview.eligible === 0 || dirty}
                  aria-busy={busy === "confirm"}
                  onClick={() => void confirm()}
                >
                  {busy === "confirm" ? copy.confirm.confirming : copy.confirm.confirm}
                </button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
