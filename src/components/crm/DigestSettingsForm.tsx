"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Select } from "@/components/Select";

type Labels = {
  digestEnabled: string;
  digestHour: string;
  digestPhone: string;
  digestOptInText: string;
  digestFeatureOff: string;
  save: string;
  saving: string;
  saved: string;
  loadFailed: string;
};

type Settings = {
  featureOn: boolean;
  digestEnabled: boolean;
  digestHour: number;
  timezone: string;
  me: { phone: string; optedIn: boolean } | null;
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00`,
}));

export function DigestSettingsForm({ labels }: { labels: Labels }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestHour, setDigestHour] = useState("8");
  const [phone, setPhone] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/crm/digest-settings");
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? labels.loadFailed);
      return;
    }
    const data = (await res.json()) as Settings;
    setSettings(data);
    setDigestEnabled(data.digestEnabled);
    setDigestHour(String(data.digestHour));
    setPhone(data.me?.phone ?? "");
    setOptIn(data.me?.optedIn ?? false);
  }, [labels.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/crm/digest-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          digestEnabled,
          digestHour: Number(digestHour),
          phone,
          optIn,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Settings & { error?: string };
      if (!res.ok) {
        setError(data.error ?? labels.loadFailed);
        return;
      }
      setSettings(data);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <p className="muted">…</p>;

  return (
    <form onSubmit={(e) => void save(e)} className="card stack form-narrow">
      {!settings.featureOn ? <div className="status-banner warn">{labels.digestFeatureOff}</div> : null}

      <label className="choice">
        <input type="checkbox" checked={digestEnabled} onChange={(e) => setDigestEnabled(e.target.checked)} />
        {labels.digestEnabled}
      </label>

      <label>
        {labels.digestHour}
        <Select
          value={digestHour}
          onChange={setDigestHour}
          options={HOUR_OPTIONS}
          ariaLabel={labels.digestHour}
        />
      </label>

      <label>
        {labels.digestPhone}
        <input
          type="tel"
          className="ltr-isolate"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+972501234567"
        />
      </label>

      <label className="choice">
        <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
        {labels.digestOptInText}
      </label>

      {error ? <p className="muted">{error}</p> : null}
      {saved && !error ? <p className="muted">{labels.saved}</p> : null}

      <div className="field-form-actions">
        <button type="submit" className="btn" disabled={saving} aria-busy={saving}>
          {saving ? labels.saving : labels.save}
        </button>
      </div>
    </form>
  );
}
