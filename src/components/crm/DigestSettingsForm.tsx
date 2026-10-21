"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Select } from "@/components/Select";
import { Icon } from "@/components/crm/Icon";

type Sector = "general" | "hospitality" | "appointments";

export type DigestPreview = { body: string; footer: string; button: string };

type Labels = {
  digestEnabled: string;
  digestHour: string;
  digestFeatureOff: string;
  digestSector: string;
  digestSectorAuto: string;
  digestSectorNames: Record<Sector, string>;
  digestConnect: string;
  digestConnectOpen: string;
  digestConnectedTo: string;
  digestDisconnect: string;
  digestNoPlatformNumber: string;
  digestWhatsAppTitle: string;
  digestSettingsTitle: string;
  digestStatusOn: string;
  digestStatusOff: string;
  digestStepCopy: string;
  digestStepSend: string;
  digestCopy: string;
  digestCopied: string;
  digestCodeExpiry: string;
  digestNewCode: string;
  digestRefresh: string;
  digestPreview: string;
  digestConnectIntro: string;
  alertsTitle: string;
  alertsBlurb: string;
  alertsEnabled: string;
  alertApprovals: string;
  alertHandoffs: string;
  alertsNeedConnect: string;
  quietHoursEnabled: string;
  quietFrom: string;
  quietTo: string;
  quietMode: string;
  quietModeNames: Record<QuietMode, string>;
  save: string;
  saving: string;
  saved: string;
  loadFailed: string;
};

type QuietMode = "hold" | "digest";

type Alerts = {
  enabled: boolean;
  approvals: boolean;
  handoffs: boolean;
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  quietMode: QuietMode;
};

type Settings = {
  featureOn: boolean;
  digestEnabled: boolean;
  digestHour: number;
  timezone: string;
  digestSector: "" | Sector;
  autoSector: Sector;
  alerts: Alerts;
  platformNumber: string;
  me: { phone: string; optedIn: boolean; code: string | null } | null;
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00`,
}));

const SECTORS: Sector[] = ["general", "hospitality", "appointments"];
const QUIET_MODES: QuietMode[] = ["hold", "digest"];

/** 972555076806 -> +972 55-507-6806 (Israeli mobiles); anything else just gets a +. */
function formatPhone(digits: string): string {
  const il = /^972(5\d)(\d{3})(\d{4})$/.exec(digits);
  return il ? `+972 ${il[1]}-${il[2]}-${il[3]}` : `+${digits}`;
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // no clipboard (http, old browser): the code stays selectable
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className="btn-secondary digest-copy" onClick={() => void copy()} aria-live="polite">
      {copied ? <Icon name="check" small /> : <CopyIcon />}
      {copied ? done : label}
    </button>
  );
}

function RefreshIcon() {
  return (
    <svg className="crm-i sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="crm-i sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

export function DigestSettingsForm({ labels, previews }: { labels: Labels; previews: Record<Sector, DigestPreview> }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestHour, setDigestHour] = useState("8");
  const [digestSector, setDigestSector] = useState<"" | Sector>("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [alertsSaved, setAlertsSaved] = useState(false);

  const apply = useCallback((data: Settings) => {
    setSettings(data);
    setDigestEnabled(data.digestEnabled);
    setDigestHour(String(data.digestHour));
    setDigestSector(data.digestSector);
    setAlerts(data.alerts);
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

  /** Re-reads the connection after the owner sends START, leaving unsaved form edits alone. */
  async function refresh() {
    setError("");
    setRefreshing(true);
    try {
      const res = await fetch("/api/crm/digest-settings");
      if (res.ok) setSettings((await res.json()) as Settings);
      else setError(labels.loadFailed);
    } finally {
      setRefreshing(false);
    }
  }

  async function put(body: Record<string, unknown>): Promise<boolean> {
    setError("");
    setSaved(false);
    setAlertsSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/crm/digest-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Settings & {
        error?: string;
      };
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

  async function saveAlerts(e: FormEvent) {
    e.preventDefault();
    if (!alerts) return;
    const ok = await put({
      alertsEnabled: alerts.enabled,
      alertApprovals: alerts.approvals,
      alertHandoffs: alerts.handoffs,
      quietHoursEnabled: alerts.quietHoursEnabled,
      quietStartHour: alerts.quietStartHour,
      quietEndHour: alerts.quietEndHour,
      quietMode: alerts.quietMode,
    });
    if (ok) setAlertsSaved(true);
  }

  if (!settings || !alerts) return <p className="muted">…</p>;

  const setAlert = (patch: Partial<Alerts>) => {
    setAlerts({ ...alerts, ...patch });
    setAlertsSaved(false);
  };

  const me = settings.me;
  const connected = Boolean(me?.optedIn);
  const sectorOptions = [
    {
      value: "",
      label: `${labels.digestSectorAuto} · ${labels.digestSectorNames[settings.autoSector]}`,
    },
    ...SECTORS.map((s) => ({ value: s, label: labels.digestSectorNames[s] })),
  ];
  const preview = previews[digestSector || settings.autoSector];
  const startText = me?.code ? `START ${me.code}` : "";
  const waLink =
    startText && settings.platformNumber
      ? `https://wa.me/${settings.platformNumber}?text=${encodeURIComponent(startText)}`
      : "";

  return (
    <div className="digest-page form-narrow">
      {!settings.featureOn ? <div className="status-banner warn">{labels.digestFeatureOff}</div> : null}

      <section className="card digest-card">
        <header className="digest-card-head">
          <h2>{labels.digestWhatsAppTitle}</h2>
          <div className="digest-card-status">
            <span className={connected ? "badge" : "badge badge-demo"}>
              {connected ? labels.digestStatusOn : labels.digestStatusOff}
            </span>
            <button
              type="button"
              className="btn-ghost digest-refresh"
              disabled={refreshing}
              aria-busy={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshIcon />
              {labels.digestRefresh}
            </button>
          </div>
        </header>

        {connected ? (
          <div className="digest-connected">
            <span className="digest-connected-icon">
              <Icon name="check" />
            </span>
            <p>
              {labels.digestConnectedTo} <bdi className="digest-phone">{formatPhone(me!.phone)}</bdi>
            </p>
            <button
              type="button"
              className="btn-ghost"
              disabled={saving}
              onClick={() => void put({ action: "disconnect" })}
            >
              {labels.digestDisconnect}
            </button>
          </div>
        ) : me?.code ? (
          <div className="digest-connect">
            <ol className="digest-steps">
              <li>
                <span className="digest-step-title">{labels.digestStepCopy}</span>
                <div className="digest-code-row">
                  <code className="digest-code" dir="ltr">
                    {startText}
                  </code>
                  <CopyButton text={startText} label={labels.digestCopy} done={labels.digestCopied} />
                </div>
              </li>
              <li>
                <span className="digest-step-title">{labels.digestStepSend}</span>
                {settings.platformNumber ? (
                  <div className="digest-code-row">
                    <bdi className="digest-phone">{formatPhone(settings.platformNumber)}</bdi>
                    {waLink ? (
                      <a className="btn digest-wa" href={waLink} target="_blank" rel="noreferrer">
                        <Icon name="msg" small />
                        {labels.digestConnectOpen}
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted">{labels.digestNoPlatformNumber}</p>
                )}
              </li>
            </ol>
            <p className="muted digest-expiry">
              {labels.digestCodeExpiry}{" "}
              <button
                type="button"
                className="digest-link"
                disabled={saving}
                onClick={() => void put({ action: "connect" })}
              >
                {labels.digestNewCode}
              </button>
            </p>
          </div>
        ) : (
          <div className="digest-intro">
            <p>{labels.digestConnectIntro}</p>
            <button type="button" className="btn" disabled={saving} onClick={() => void put({ action: "connect" })}>
              {labels.digestConnect}
            </button>
          </div>
        )}
      </section>

      <form onSubmit={(e) => void save(e)} className="card digest-card">
        <header className="digest-card-head">
          <h2>{labels.digestSettingsTitle}</h2>
        </header>

        <div className="digest-settings-grid">
          <div className="stack">
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
              {labels.digestSector}
              <Select
                value={digestSector}
                onChange={(v) => setDigestSector(v as "" | Sector)}
                options={sectorOptions}
                ariaLabel={labels.digestSector}
              />
            </label>

            <div className="field-form-actions digest-save">
              <button type="submit" className="btn" disabled={saving} aria-busy={saving}>
                {saving ? labels.saving : labels.save}
              </button>
              {saved && !error ? (
                <span className="muted digest-saved">
                  <Icon name="check" small /> {labels.saved}
                </span>
              ) : null}
            </div>
          </div>

          <figure className="digest-preview">
            <figcaption className="muted">{labels.digestPreview}</figcaption>
            <div className="digest-chat" dir="rtl">
              <div className="digest-bubble">
                <p className="digest-bubble-body">{preview.body}</p>
                <p className="digest-bubble-footer">{preview.footer}</p>
                <span className="digest-bubble-time">{`${digestHour.padStart(2, "0")}:00`}</span>
              </div>
              <div className="digest-bubble-button">{preview.button}</div>
            </div>
          </figure>
        </div>
      </form>

      <form onSubmit={(e) => void saveAlerts(e)} className="card digest-card">
        <header className="digest-card-head">
          <h2>{labels.alertsTitle}</h2>
        </header>
        <p className="muted">{labels.alertsBlurb}</p>
        {!connected ? <p className="muted">{labels.alertsNeedConnect}</p> : null}

        <div className="stack">
          <label className="choice">
            <input type="checkbox" checked={alerts.enabled} onChange={(e) => setAlert({ enabled: e.target.checked })} />
            {labels.alertsEnabled}
          </label>

          <fieldset className="stack digest-alert-kinds" disabled={!alerts.enabled}>
            <label className="choice">
              <input
                type="checkbox"
                checked={alerts.approvals}
                onChange={(e) => setAlert({ approvals: e.target.checked })}
              />
              {labels.alertApprovals}
            </label>
            <label className="choice">
              <input
                type="checkbox"
                checked={alerts.handoffs}
                onChange={(e) => setAlert({ handoffs: e.target.checked })}
              />
              {labels.alertHandoffs}
            </label>

            <label className="choice">
              <input
                type="checkbox"
                checked={alerts.quietHoursEnabled}
                onChange={(e) => setAlert({ quietHoursEnabled: e.target.checked })}
              />
              {labels.quietHoursEnabled}
            </label>

            {alerts.quietHoursEnabled ? (
              <>
                <div className="digest-quiet-range">
                  <label>
                    {labels.quietFrom}
                    <Select
                      value={String(alerts.quietStartHour)}
                      onChange={(v) => setAlert({ quietStartHour: Number(v) })}
                      options={HOUR_OPTIONS}
                      ariaLabel={labels.quietFrom}
                    />
                  </label>
                  <label>
                    {labels.quietTo}
                    <Select
                      value={String(alerts.quietEndHour)}
                      onChange={(v) => setAlert({ quietEndHour: Number(v) })}
                      options={HOUR_OPTIONS}
                      ariaLabel={labels.quietTo}
                    />
                  </label>
                </div>
                <label>
                  {labels.quietMode}
                  <Select
                    value={alerts.quietMode}
                    onChange={(v) => setAlert({ quietMode: v as QuietMode })}
                    options={QUIET_MODES.map((m) => ({ value: m, label: labels.quietModeNames[m] }))}
                    ariaLabel={labels.quietMode}
                  />
                </label>
              </>
            ) : null}
          </fieldset>

          <div className="field-form-actions digest-save">
            <button type="submit" className="btn" disabled={saving} aria-busy={saving}>
              {saving ? labels.saving : labels.save}
            </button>
            {alertsSaved && !error ? (
              <span className="muted digest-saved">
                <Icon name="check" small /> {labels.saved}
              </span>
            ) : null}
          </div>
        </div>
      </form>

      {error ? <div className="status-banner warn">{error}</div> : null}
    </div>
  );
}
