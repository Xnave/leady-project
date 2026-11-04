"use client";

import { useState, type FormEvent } from "react";
import { absTime } from "@/components/crm/format";
import type { CampaignSettings } from "@/lib/campaigns/settings";
import { fillUi, type UiCopy, type UiLang } from "@/lib/ui";

type Copy = UiCopy["campaigns"]["admin"];

export function AdminCampaignSettings({
  tenantId,
  copy,
  lang,
  initial,
  whatsappPhone,
}: {
  tenantId: string;
  copy: Copy;
  lang: UiLang;
  initial: CampaignSettings;
  whatsappPhone: string | null;
}) {
  const [settings, setSettings] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [adPrefixEnabled, setAdPrefixEnabled] = useState(initial.adPrefixEnabled);
  const [note, setNote] = useState(initial.adPrefixOffNote);
  const [ceiling, setCeiling] = useState(String(initial.dailySendCeiling));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/campaigns`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, adPrefixEnabled, adPrefixOffNote: note, dailySendCeiling: Number(ceiling) }),
      });
      const data = (await res.json().catch(() => ({}))) as { settings?: CampaignSettings; error?: string };
      if (!res.ok || !data.settings) {
        const key = (data.error ?? "failed") as keyof Copy["errors"];
        setMessage({ ok: false, text: copy.errors[key] ?? copy.errors.failed });
        return;
      }
      setSettings(data.settings);
      setNote(data.settings.adPrefixOffNote);
      setMessage({ ok: true, text: copy.saved });
    } catch {
      setMessage({ ok: false, text: copy.errors.failed });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card campaign-card campaign-admin" onSubmit={(e) => void save(e)}>
      <label className="choice">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {copy.enabled}
      </label>
      <p className="muted campaign-hint">{copy.enabledHint}</p>

      <label className="choice">
        <input type="checkbox" checked={adPrefixEnabled} onChange={(e) => setAdPrefixEnabled(e.target.checked)} />
        {copy.adPrefix}
      </label>
      <p className="muted campaign-hint">{copy.adPrefixHint}</p>
      {!adPrefixEnabled ? (
        <label>
          {copy.adPrefixNote}
          <textarea rows={3} value={note} placeholder={copy.adPrefixNoteHint} onChange={(e) => setNote(e.target.value)} />
        </label>
      ) : null}
      {!settings.adPrefixEnabled && settings.adPrefixOffAt ? (
        <p className="muted campaign-hint">
          {fillUi(copy.adPrefixOffBy, { who: settings.adPrefixOffBy || "-", when: absTime(settings.adPrefixOffAt, lang) })}
        </p>
      ) : null}

      <label>
        {copy.ceiling}
        <input type="number" min={1} max={100000} step={1} value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
      </label>
      <p className="muted campaign-hint">{copy.ceilingHint}</p>

      <dl className="campaign-admin-facts">
        <dt>{copy.whatsapp}</dt>
        <dd dir="ltr">{whatsappPhone ?? copy.noWhatsApp}</dd>
        <dt>{copy.terms}</dt>
        <dd>
          {settings.termsAcceptedAt
            ? `${settings.termsVersion} · ${absTime(settings.termsAcceptedAt, lang)} · ${settings.termsAcceptedBy}`
            : copy.termsNone}
        </dd>
      </dl>

      {message ? <p className={message.ok ? "muted" : "campaign-error"}>{message.text}</p> : null}
      <div className="field-form-actions">
        <button type="submit" className="btn" disabled={saving} aria-busy={saving}>
          {saving ? copy.saving : copy.save}
        </button>
      </div>
    </form>
  );
}
