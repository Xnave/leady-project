"use client";

import { useState, type FormEvent } from "react";
import { absTime } from "@/components/crm/format";
import type { PublicClientSource } from "@/lib/client-sources/store";
import { fillUi, type UiCopy, type UiLang } from "@/lib/ui";

type Copy = UiCopy["clientSources"];

export type ConnectorOption = {
  kind: string;
  label: string;
  credentialFields: { key: string; label: string; secret: boolean }[];
  /** The tenant already saved this CRM's key elsewhere (Documents settings). */
  sharedCredentials: boolean;
  defaultConfig: string;
};

type TestResult =
  | { ok: true; counts: { synced: number; noPhone: number; invalidPhone: number; skipped: number }; fieldKeys: string[]; morePages: boolean }
  | { ok: false; error: string };

const STAT_KEYS = ["synced", "created", "updated", "skipped", "outOfScope", "noPhone", "invalidPhone", "duplicatePhone", "linkedLeads"] as const;

export function AdminClientSources({
  tenantId,
  copy,
  lang,
  connectors,
  initial,
}: {
  tenantId: string;
  copy: Copy;
  lang: UiLang;
  connectors: ConnectorOption[];
  initial: PublicClientSource[];
}) {
  const a = copy.admin;
  const [sources, setSources] = useState(initial);
  const [kind, setKind] = useState(initial[0]?.kind ?? connectors[0]?.kind ?? "");
  const connector = connectors.find((c) => c.kind === kind);
  const existing = sources.find((s) => s.kind === kind);
  const [label, setLabel] = useState(existing?.label ?? "");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [config, setConfig] = useState(existing ? JSON.stringify(existing.config, null, 2) : connector?.defaultConfig ?? "{}");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  function pickKind(next: string) {
    setKind(next);
    const src = sources.find((s) => s.kind === next);
    const conn = connectors.find((c) => c.kind === next);
    setLabel(src?.label ?? "");
    setCredentials({});
    setConfig(src ? JSON.stringify(src.config, null, 2) : conn?.defaultConfig ?? "{}");
    setMessage(null);
  }

  async function refresh() {
    const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/client-sources`);
    const data = (await res.json().catch(() => ({}))) as { sources?: PublicClientSource[] };
    if (data.sources) setSources(data.sources);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    let parsedConfig: unknown = {};
    try {
      parsedConfig = config.trim() ? JSON.parse(config) : {};
    } catch {
      setMessage({ ok: false, text: a.errors.bad_json });
      return;
    }
    setBusy("save");
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/client-sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, label, credentials, config: parsedConfig }),
      });
      const data = (await res.json().catch(() => ({}))) as { source?: PublicClientSource; error?: string; detail?: string };
      if (!res.ok || !data.source) {
        const key = (data.error ?? "failed") as keyof Copy["admin"]["errors"];
        const text = a.errors[key] ?? a.errors.failed;
        setMessage({ ok: false, text: data.detail ? `${text} ${data.detail}` : text });
        return;
      }
      setCredentials({});
      setConfig(JSON.stringify(data.source.config, null, 2));
      setMessage({ ok: true, text: a.saved });
      await refresh();
    } catch {
      setMessage({ ok: false, text: a.errors.failed });
    } finally {
      setBusy(null);
    }
  }

  async function runTest(sourceId: string) {
    setBusy(`test:${sourceId}`);
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/client-sources/${encodeURIComponent(sourceId)}/test`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({ ok: false, error: a.errors.failed }))) as TestResult;
      setTests((t) => ({ ...t, [sourceId]: data }));
    } finally {
      setBusy(null);
    }
  }

  async function runSync(sourceId: string) {
    setBusy(`sync:${sourceId}`);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/client-sources/${encodeURIComponent(sourceId)}/sync`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { queued?: boolean; error?: string };
      if (!res.ok) setMessage({ ok: false, text: data.error ?? a.errors.failed });
      else setMessage({ ok: true, text: data.queued ? a.syncQueued : a.syncDone });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card">
        <h2>{a.sources}</h2>
        {sources.length === 0 ? <p className="muted">{a.empty}</p> : null}
        {sources.map((s) => {
          const test = tests[s.id];
          return (
            <div key={s.id} className="client-source">
              <div className="client-source-head">
                <strong>{s.label || s.kindLabel[lang]}</strong>
                <span className={`badge${s.status === "error" ? " badge-warn" : ""}`}>{copy.statuses[s.status as keyof Copy["statuses"]] ?? s.status}</span>
              </div>
              <dl className="client-source-facts">
                <dt>{a.kind}</dt>
                <dd>{s.kindLabel[lang]}</dd>
                <dt>{a.contacts}</dt>
                <dd>{s.contactCount}</dd>
                <dt>{a.lastSync}</dt>
                <dd>{s.lastSyncAt ? absTime(s.lastSyncAt, lang) : a.never}</dd>
                {STAT_KEYS.filter((k) => s.lastSyncStats[k] != null).map((k) => (
                  <span key={k} className="client-source-stat">
                    <dt>{copy.stats[k]}</dt>
                    <dd>{s.lastSyncStats[k]}</dd>
                  </span>
                ))}
                {s.lastError ? (
                  <>
                    <dt>{a.lastError}</dt>
                    <dd className="client-source-error" dir="ltr">
                      {s.lastError}
                    </dd>
                  </>
                ) : null}
              </dl>
              {test ? (
                test.ok ? (
                  <p className="muted">
                    {fillUi(a.testOk, { n: test.counts.synced })} {test.morePages ? a.testMore : ""}{" "}
                    {copy.stats.noPhone}: {test.counts.noPhone} · {copy.stats.invalidPhone}: {test.counts.invalidPhone}
                    <br />
                    {a.testFields}: <span dir="ltr">{test.fieldKeys.join(", ") || "-"}</span>
                  </p>
                ) : (
                  <p className="client-source-error" dir="ltr">
                    {test.error}
                  </p>
                )
              ) : null}
              <div className="field-form-actions">
                <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void runTest(s.id)}>
                  {busy === `test:${s.id}` ? a.testing : a.test}
                </button>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => void runSync(s.id)}>
                  {busy === `sync:${s.id}` ? a.syncing : a.syncNow}
                </button>
                <button type="button" className="btn-ghost" onClick={() => pickKind(s.kind)}>
                  {a.edit}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <form className="card" onSubmit={(e) => void save(e)}>
        <h2>{existing ? `${a.edit} · ${existing.label || existing.kindLabel[lang]}` : a.connect}</h2>
        <label>
          {a.kind}
          <select value={kind} onChange={(e) => pickKind(e.target.value)}>
            {connectors.map((c) => (
              <option key={c.kind} value={c.kind}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {a.label}
          <input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <p className="muted">{a.labelHint}</p>
        <fieldset>
          <legend>{a.credentials}</legend>
          {connector?.sharedCredentials ? <p className="muted">{a.sharedCredentials}</p> : null}
          {connector?.sharedCredentials ? null : connector?.credentialFields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                dir="ltr"
                value={credentials[f.key] ?? ""}
                required={!existing}
                onChange={(e) => setCredentials((c) => ({ ...c, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          {existing && !connector?.sharedCredentials ? <p className="muted">{a.keepCredentials}</p> : null}
        </fieldset>
        <label>
          {a.config}
          <textarea rows={12} dir="ltr" className="mono" value={config} onChange={(e) => setConfig(e.target.value)} />
        </label>
        <p className="muted">{a.configHint}</p>
        {message ? <p className={message.ok ? "muted" : "client-source-error"}>{message.text}</p> : null}
        <div className="field-form-actions">
          <button type="submit" className="btn" disabled={busy !== null || !connector} aria-busy={busy === "save"}>
            {busy === "save" ? a.saving : a.save}
          </button>
        </div>
      </form>
    </>
  );
}
