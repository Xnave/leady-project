"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Select } from "@/components/Select";

type Sector = "general" | "hospitality" | "appointments";

type Labels = {
  digestEnabled: string;
  digestHour: string;
  digestFeatureOff: string;
  digestSector: string;
  digestSectorAuto: string;
  digestSectorNames: Record<Sector, string>;
  digestConnect: string;
  digestConnectHint: string;
  digestConnectOpen: string;
  digestConnectedTo: string;
  digestDisconnect: string;
  digestNoPlatformNumber: string;
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
  digestSector: "" | Sector;
  autoSector: Sector;
  platformNumber: string;
  me: { phone: string; optedIn: boolean; code: string | null } | null;
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00`,
}));

const SECTORS: Sector[] = ["general", "hospitality", "appointments"];

export function DigestSettingsForm({ labels }: { labels: Labels }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestHour, setDigestHour] = useState("8");
  const [digestSector, setDigestSector] = useState<"" | Sector>("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const apply = useCallback((data: Settings) => {
    setSettings(data);
    setDigestEnabled(data.digestEnabled);
    setDigestHour(String(data.digestHour));
    setDigestSector(data.digestSector);
  }, []);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/crm/digest-settings");
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? labels.loadFailed);
      return;
    }
    apply((await res.json()) as Settings);
  }, [apply, labels.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function put(body: Record<string, unknown>): Promise<boolean> {
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/crm/digest-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Settings & { error?: string };
      if (!res.ok) {
        setError(data.error ?? labels.loadFailed);
        return false;
      }
      setSettings(data);
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (await put({ digestEnabled, digestHour: Number(digestHour), digestSector })) setSaved(true);
  }

  if (!settings) return <p className="muted">…</p>;

  const me = settings.me;
  const sectorOptions = [
    { value: "", label: `${labels.digestSectorAuto} · ${labels.digestSectorNames[settings.autoSector]}` },
    ...SECTORS.map((s) => ({ value: s, label: labels.digestSectorNames[s] })),
  ];
  const startText = me?.code ? `START ${me.code}` : "";
  const waLink =
    startText && settings.platformNumber
      ? `https://wa.me/${settings.platformNumber}?text=${encodeURIComponent(startText)}`
      : "";

  return (
    <div className="stack form-narrow">
      <form onSubmit={(e) => void save(e)} className="card stack">
        {!settings.featureOn ? <div className="status-banner warn">{labels.digestFeatureOff}</div> : null}

        <label className="choice">
          <input type="checkbox" checked={digestEnabled} onChange={(e) => setDigestEnabled(e.target.checked)} />
          {labels.digestEnabled}
        </label>

        <label>
          {labels.digestHour}
          <Select value={digestHour} onChange={setDigestHour} options={HOUR_OPTIONS} ariaLabel={labels.digestHour} />
        </label>

        <label>
          {labels.digestSector}
          <Select
            value={digestSector}
            onChange={(v) => setDigestSector(v as "" | Sector)}
            options={sectorOptions}
            ariaLabel={labels.digestSector}
          />
        </label>

        {saved && !error ? <p className="muted">{labels.saved}</p> : null}

        <div className="field-form-actions">
          <button type="submit" className="btn" disabled={saving} aria-busy={saving}>
            {saving ? labels.saving : labels.save}
          </button>
        </div>
      </form>

      <div className="card stack">
        {me?.optedIn ? (
          <>
            <p>
              {labels.digestConnectedTo} <bdi className="ltr-isolate">+{me.phone}</bdi>
            </p>
            <div className="field-form-actions">
              <button type="button" className="btn-secondary" disabled={saving} onClick={() => void put({ action: "disconnect" })}>
                {labels.digestDisconnect}
              </button>
            </div>
          </>
        ) : me?.code ? (
          <>
            <p className="muted">{labels.digestConnectHint}</p>
            <p>
              <code className="ltr-isolate">{startText}</code>
            </p>
            {waLink ? (
              <div className="field-form-actions">
                <a className="btn" href={waLink} target="_blank" rel="noreferrer">
                  {labels.digestConnectOpen}
                </a>
              </div>
            ) : (
              <p className="muted">{labels.digestNoPlatformNumber}</p>
            )}
          </>
        ) : (
          <div className="field-form-actions">
            <button type="button" className="btn" disabled={saving} onClick={() => void put({ action: "connect" })}>
              {labels.digestConnect}
            </button>
          </div>
        )}
      </div>

      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
