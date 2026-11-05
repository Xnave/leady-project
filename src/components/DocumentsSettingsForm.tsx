"use client";

import { useState } from "react";
import type { UiCopy } from "@/lib/ui";

type Props = {
  ui: UiCopy;
  enabled: boolean;
  baseUrl: string;
  hasKey: boolean;
  testPhones: string;
  rules: string;
};

export function DocumentsSettingsForm(props: Props) {
  const copy = props.ui.documentsUi;
  const [enabled, setEnabled] = useState(props.enabled);
  const [baseUrl, setBaseUrl] = useState(props.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [rules, setRules] = useState(props.rules);
  const [testPhones, setTestPhones] = useState(props.testPhones);
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, baseUrl, apiKey, rules, testPhones }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? copy.failed);
      setApiKey("");
      setMessage(copy.saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.failed);
    } finally {
      setPending(false);
    }
  }

  async function testConnection() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/documents/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey, phone }),
      });
      const data = (await res.json()) as { error?: string; found?: boolean };
      if (!res.ok) throw new Error(data.error ?? copy.failed);
      setMessage(data.found ? copy.testOk : copy.testMissing);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="stack">
      <label className="chip-toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {copy.enabled}
      </label>
      <label>
        {copy.baseUrl}
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
      </label>
      <label>
        {copy.apiKey}
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={props.hasKey ? "••••" : ""}
          autoComplete="off"
        />
      </label>
      <p className="muted">{copy.apiKeyHint}</p>
      {!props.hasKey && !apiKey.trim() ? <p className="muted">{copy.testOnlyWarning}</p> : null}
      <label>
        {copy.testPhones}
        <textarea rows={3} value={testPhones} onChange={(e) => setTestPhones(e.target.value)} />
      </label>
      <p className="muted">{copy.testPhonesHint}</p>
      <label>
        {copy.rules}
        <textarea rows={16} value={rules} onChange={(e) => setRules(e.target.value)} />
      </label>
      <p className="muted">{copy.rulesHint}</p>
      <div className="wizard-footer">
        <button type="submit" className="btn" disabled={pending}>
          {props.ui.common.save}
        </button>
      </div>
      <label>
        {copy.testPhone}
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <button type="button" className="btn-secondary" disabled={pending} onClick={() => void testConnection()}>
        {copy.test}
      </button>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
