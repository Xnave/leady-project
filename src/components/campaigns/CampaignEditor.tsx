"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/crm/Icon";
import { Toast } from "@/components/Toast";
import type { EditorSource, EditorTemplate, MappedTag } from "@/lib/campaigns/page-data";
import type { Audience, ParamSpec, SendWindow } from "@/lib/campaigns/rules";
import {
  CAMPAIGN_SEND_GAP_DEFAULT_MS,
  CAMPAIGN_SEND_GAP_MAX_MS,
  CAMPAIGN_SEND_GAP_MIN_MS,
  DECLARATION_VERSION,
  DEFAULT_SEND_WINDOW,
  documentsFollowUps,
  PARAM_SOURCES,
  parseFollowUps,
} from "@/lib/campaigns/rules";
import { fillUi, type UiCopy, type UiLang } from "@/lib/ui";

type Copy = UiCopy["campaigns"]["run"];
type Builtin = Exclude<(typeof PARAM_SOURCES)[number], "mapped">;
const BUILTIN: Builtin[] = ["first_name", "full_name", "borrower_first_name", "business_name", "text"];

export type EditorInitial = {
  id: string;
  name: string;
  templateId: string;
  audience: Audience;
  params: ParamSpec[];
  scheduledAt: string | null;
  sendWindow: SendWindow | null;
  followUps?: unknown;
  sendGapMs?: number | null;
};

type Preview = { total: number; eligible: number; skipped: Record<string, number>; sample: string[]; costUsd: number };
type Person = { id: string; name: string; contactId: string | null; leadId: string | null };

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type DayDraft = { weekday: number; open: boolean; start: string; end: string };

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

function daysFromWindow(window: SendWindow): DayDraft[] {
  return WEEKDAYS.map((_, weekday) => {
    const day = window.days.find((d) => d.weekday === weekday);
    return {
      weekday,
      open: Boolean(day),
      start: minutesToTime(day?.startMinute ?? 9 * 60),
      end: minutesToTime(day?.endMinute ?? 20 * 60),
    };
  });
}

function windowFromDays(days: DayDraft[]): SendWindow {
  return {
    days: days.flatMap((d) => {
      if (!d.open) return [];
      const startMinute = timeToMinutes(d.start);
      const endMinute = timeToMinutes(d.end);
      if (startMinute == null || endMinute == null || startMinute >= endMinute) return [{ weekday: d.weekday, startMinute: -1, endMinute: -1 }];
      return [{ weekday: d.weekday, startMinute, endMinute }];
    }),
  };
}

function windowSummary(window: SendWindow, names: Copy["form"]["weekdays"], closed: string): string {
  const byDay = new Map(window.days.map((d) => [d.weekday, d]));
  const parts: string[] = [];
  let i = 0;
  while (i < WEEKDAYS.length) {
    const day = byDay.get(i);
    const name = names[WEEKDAYS[i]];
    if (!day) {
      parts.push(`${name} ${closed}`);
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < WEEKDAYS.length) {
      const next = byDay.get(j + 1);
      if (!next || next.startMinute !== day.startMinute || next.endMinute !== day.endMinute) break;
      j += 1;
    }
    const label = i === j ? name : `${name}–${names[WEEKDAYS[j]]}`;
    parts.push(`${label} ${minutesToTime(day.startMinute)}–${minutesToTime(day.endMinute)}`);
    i = j + 1;
  }
  return parts.join(", ");
}

function chipName(spec: ParamSpec | undefined): string {
  if (!spec) return "first_name";
  if (spec.source === "mapped") return spec.key || "mapped";
  return spec.source;
}

function MessageBody({
  body,
  specs,
  selected,
  onSelect,
}: {
  body: string;
  specs: ParamSpec[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const parts = body.split(/(\{\{\d+\}\})/g);
  return (
    <p className="campaign-template-text">
      {parts.map((part, index) => {
        const match = /^\{\{(\d+)\}\}$/.exec(part);
        if (!match) return <span key={index}>{part}</span>;
        const slot = Number(match[1]) - 1;
        return (
          <button
            key={index}
            type="button"
            className="campaign-chip"
            aria-pressed={selected === slot}
            onClick={() => onSelect(slot)}
          >
            {`{{${chipName(specs[slot])}}}`}
          </button>
        );
      })}
    </p>
  );
}

function PersonDialog({
  mode,
  campaignId,
  params,
  copy,
  onClose,
  onAllowed,
}: {
  mode: "preview" | "allow";
  campaignId: string;
  params: ParamSpec[];
  copy: Copy;
  onClose: () => void;
  onAllowed: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const f = copy.form;
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState("");
  const [filled, setFilled] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(from: string) {
    setBusy(true);
    setError("");
    const query = new URLSearchParams();
    if (mode === "allow") query.set("reason", "not_allowlisted");
    if (from) query.set("cursor", from);
    try {
      const res = await fetch(`/api/campaigns/runs/${encodeURIComponent(campaignId)}/audience?${query}`);
      const out = (await res.json().catch(() => ({}))) as { people?: Person[]; nextCursor?: string | null; error?: string };
      if (!res.ok) {
        setError(copy.errors.failed);
        return;
      }
      setPeople(out.people ?? []);
      setCursor(from);
      setNextCursor(out.nextCursor ?? null);
      setPickedId("");
      setFilled("");
    } catch {
      setError(copy.errors.failed);
    } finally {
      setLoaded(true);
      setBusy(false);
    }
  }

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    void load("");
    // The first page is the dialog's initial view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, mode]);

  async function pick(person: Person) {
    if (mode === "allow") {
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/campaigns/allowlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contactId: person.contactId, leadId: person.leadId }),
        });
        if (!res.ok) {
          setError(copy.errors.failed);
          return;
        }
        onAllowed();
        await load(cursor);
      } catch {
        setError(copy.errors.failed);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/runs/${encodeURIComponent(campaignId)}/preview-recipient`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: person.contactId, leadId: person.leadId, params }),
      });
      const out = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (out.error === "missing_param") setError(f.previewMissing);
      else if (!res.ok || !out.text) setError(copy.errors.failed);
      else {
        setPickedId(person.id);
        setFilled(out.text);
      }
    } catch {
      setError(copy.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "allow" ? copy.confirm.allowTitle : f.previewTitle;
  return (
    <dialog
      ref={ref}
      className="cl-sheet"
      aria-labelledby="campaign-people-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="cl-sheet-body campaign-people-sheet">
        <header className="cl-sheet-head">
          <h2 id="campaign-people-title">{title}</h2>
          <button type="button" className="btn-icon" aria-label={f.close} onClick={() => ref.current?.close()}>
            <Icon name="x" />
          </button>
        </header>
        <p className="muted cl-sheet-hint">{mode === "allow" ? copy.confirm.allowHint : f.previewPick}</p>
        {filled ? <p className="campaign-template-text campaign-confirm">{filled}</p> : null}
        {error ? <p className="campaign-error">{error}</p> : null}
        <div className="campaign-people-scroll">
          {loaded && people.length === 0 && !busy ? <p className="muted">{mode === "allow" ? copy.confirm.allowEmpty : f.previewEmpty}</p> : null}
          <ul className="campaign-people">
            {people.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className="campaign-person"
                  aria-pressed={person.id === pickedId}
                  disabled={busy}
                  onClick={() => void pick(person)}
                >
                  <span>{person.name}</span>
                  {mode === "allow" ? <span>{copy.confirm.allowAction}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void load(nextCursor)}>
              {f.more}
            </button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

export function CampaignEditor({
  copy,
  lang,
  data,
  pickedLeadIds,
  initial,
  live = false,
}: {
  copy: Copy;
  lang: UiLang;
  data: { templates: EditorTemplate[]; sources: EditorSource[]; mappedTags: MappedTag[]; hasClientSource: boolean; businessName: string; whatsappPhone: string | null };
  pickedLeadIds: string[];
  initial: EditorInitial | null;
  /** An already scheduled campaign: save the setup, without the first-send confirmation. */
  live?: boolean;
}) {
  const router = useRouter();
  const f = copy.form;
  const initialLeads = initial?.audience.kind === "leads" ? initial.audience.leadIds : pickedLeadIds;
  const initialClients = initial?.audience.kind === "clients" ? initial.audience : null;
  const hadCustomWhen = Boolean(initial?.scheduledAt || initial?.sendWindow);

  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [templateId, setTemplateId] = useState(initial?.templateId ?? data.templates[0]?.id ?? "");
  const [reminderTemplateId, setReminderTemplateId] = useState(
    () => parseFollowUps(initial?.followUps).find((step) => step.onSilence === "send")?.templateId ?? "",
  );
  const [followHours, setFollowHours] = useState(() => {
    const step = parseFollowUps(initial?.followUps).find((s) => s.onSilence === "send");
    return step ? String(Math.max(1, Math.round(step.delayMs / 3_600_000))) : "48";
  });
  const [gapSeconds, setGapSeconds] = useState(() => {
    const stored = initial?.sendGapMs;
    const seconds = stored == null || stored < CAMPAIGN_SEND_GAP_MIN_MS ? CAMPAIGN_SEND_GAP_DEFAULT_MS / 1000 : Math.round(stored / 1000);
    return String(Math.min(CAMPAIGN_SEND_GAP_MAX_MS / 1000, Math.max(CAMPAIGN_SEND_GAP_MIN_MS / 1000, seconds)));
  });
  const [audienceKind, setAudienceKind] = useState<"clients" | "leads">(initialLeads.length ? "leads" : "clients");
  const [sourceId, setSourceId] = useState(initialClients?.sourceId ?? (data.sources.length === 1 ? data.sources[0].id : "all"));
  const [params, setParams] = useState<ParamSpec[]>(initial?.params ?? []);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [days, setDays] = useState<DayDraft[]>(() => daysFromWindow(initial?.sendWindow ?? DEFAULT_SEND_WINDOW));
  const [customWhen, setCustomWhen] = useState(false);
  const [schedule, setSchedule] = useState(toLocalInput(initial?.scheduledAt ?? null));
  const [busy, setBusy] = useState<"" | "save" | "check" | "confirm">("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [declared, setDeclared] = useState(false);
  const [dirty, setDirty] = useState(!initial);
  const [picker, setPicker] = useState<null | { mode: "preview" | "allow"; campaignId: string }>(null);
  const [toast, setToast] = useState<string | null>(null);

  const template = data.templates.find((t) => t.id === templateId);
  const paramCount = template?.paramCount ?? 0;
  const specs: ParamSpec[] = useMemo(
    () =>
      Array.from({ length: paramCount }, (_, i) => params[i] ?? { source: i === 0 ? "first_name" : "business_name", value: "", fallback: "", key: "" }),
    [params, paramCount],
  );
  const slot = Math.min(selectedSlot, Math.max(0, paramCount - 1));
  const active = specs[slot];

  const touch = () => {
    setDirty(true);
    setPreview(null);
    setDeclared(false);
  };

  function setDay(weekday: number, patch: Partial<DayDraft>) {
    setDays((current) => current.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
    touch();
  }

  function setSpec(i: number, patch: Partial<ParamSpec>) {
    const next = [...specs];
    next[i] = { ...next[i], ...patch };
    setParams(next);
    setSelectedSlot(i);
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
        : {
            kind: "clients",
            sourceId,
            startedYearsAgoMin: null,
            startedYearsAgoMax: null,
            confidence: [],
            includeNoStartedAt: true,
          };
    const hours = Math.round(Number(followHours));
    const followUpHours = Number.isInteger(hours) && hours >= 1 && hours <= 24 * 30 ? hours : 48;
    const rawGap = Math.round(Number(gapSeconds) * 1000);
    const gapMs = Number.isInteger(rawGap)
      ? Math.min(CAMPAIGN_SEND_GAP_MAX_MS, Math.max(CAMPAIGN_SEND_GAP_MIN_MS, rawGap))
      : CAMPAIGN_SEND_GAP_DEFAULT_MS;
    const keepWhen = hadCustomWhen || customWhen;
    return {
      name,
      templateId,
      reminderTemplateId: reminderTemplateId || null,
      followUpHours,
      followUps: reminderTemplateId ? documentsFollowUps(reminderTemplateId, followUpHours * 60 * 60 * 1000) : [],
      audience,
      params: specs,
      scheduledAt: keepWhen && schedule ? new Date(schedule).toISOString() : null,
      sendWindow: keepWhen ? windowFromDays(days) : null,
      sendGapMs: gapMs,
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
      setMessage(null);
      setToast(f.saved);
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

  async function check(savedId?: string) {
    const target = savedId ?? (dirty ? await save() : id);
    if (!target) return;
    setBusy("check");
    try {
      const res = await fetch(`/api/campaigns/runs/${encodeURIComponent(target)}/preview`, { method: "POST" });
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

  async function openPicker(mode: "preview" | "allow") {
    const savedId = dirty || !id ? await save() : id;
    if (savedId) setPicker({ mode, campaignId: savedId });
  }

  if (!data.templates.length) return <p className="muted">{f.noApproved}</p>;

  const summary = windowSummary(customWhen ? windowFromDays(days) : DEFAULT_SEND_WINDOW, f.weekdays, f.dayClosed);

  return (
    <div className="campaign-page">
      <form className="card campaign-card" onSubmit={(e) => void save(e)}>
        <label>
          {f.name}
          <input value={name} maxLength={80} required onChange={(e) => (setName(e.target.value), touch())} />
        </label>
        <label>
          {f.template}
          <select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setParams([]);
              setSelectedSlot(0);
              touch();
            }}
          >
            {data.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        {template ? (
          <div className="campaign-confirm">
            <MessageBody body={template.body || template.text} specs={specs} selected={slot} onSelect={setSelectedSlot} />
            {paramCount > 0 ? (
              <>
                <p className="campaign-hint">{f.tags}</p>
                <div className="campaign-tags">
                  {BUILTIN.map((source) => (
                    <button
                      key={source}
                      type="button"
                      className="campaign-tag"
                      aria-pressed={active?.source === source}
                      onClick={() => setSpec(slot, { source, key: "" })}
                    >
                      {f.paramSources[source]}
                    </button>
                  ))}
                  {data.mappedTags.map((tag) => (
                    <button
                      key={tag.key}
                      type="button"
                      className="campaign-tag"
                      aria-pressed={active?.source === "mapped" && active.key === tag.key}
                      onClick={() => setSpec(slot, { source: "mapped", key: tag.key })}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
                {active && active.source !== "business_name" ? (
                  <div className="campaign-row">
                    {active.source === "text" ? (
                      <label>
                        {f.paramValue}
                        <input value={active.value} maxLength={200} onChange={(e) => setSpec(slot, { value: e.target.value })} />
                      </label>
                    ) : null}
                    <label>
                      {f.paramFallback}
                      <input value={active.fallback} maxLength={200} onChange={(e) => setSpec(slot, { fallback: e.target.value })} />
                    </label>
                  </div>
                ) : null}
              </>
            ) : null}
            <button type="button" className="btn-secondary" disabled={busy !== ""} onClick={() => void openPicker("preview")}>
              {f.previewPerson}
            </button>
          </div>
        ) : null}

        <div className="campaign-follow">
          <label>
            {f.followUp}
            <select value={reminderTemplateId} onChange={(e) => (setReminderTemplateId(e.target.value), touch())}>
              <option value="">{f.followUpNone}</option>
              {data.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          {reminderTemplateId ? (
            <label>
              {f.followUpAfter}
              <input
                type="number"
                min={1}
                max={24 * 30}
                step={1}
                value={followHours}
                onChange={(e) => (setFollowHours(e.target.value), touch())}
              />
            </label>
          ) : null}
          <span className="muted campaign-hint">{fillUi(f.followUpHint, { hours: followHours || "48" })}</span>
        </div>

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
              <label>
                {f.source}
                <select value={sourceId} onChange={(e) => (setSourceId(e.target.value), touch())}>
                  <option value="all">{f.sourceAll}</option>
                  {data.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label || s.kind}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted campaign-hint">{f.sourceHint}</p>
            </>
          ) : null}
        </fieldset>

        <details className="campaign-advanced" onToggle={(event) => setCustomWhen(event.currentTarget.open)}>
          <summary>
            <span className="campaign-advanced-title">
              <span>{f.advanced}</span>
              <span className="campaign-advanced-chevron" aria-hidden="true" />
            </span>
            <span className="muted">{summary}</span>
          </summary>
          <label>
            {f.schedule}
            <input type="datetime-local" value={schedule} onChange={(e) => (setSchedule(e.target.value), touch())} />
          </label>
          <p className="muted campaign-hint">{f.scheduleHint}</p>
          <fieldset>
            <legend>{f.hours}</legend>
            {days.map((d) => (
              <div key={d.weekday} className="campaign-hours">
                <label className="choice">
                  <input type="checkbox" checked={d.open} onChange={(e) => setDay(d.weekday, { open: e.target.checked })} />
                  {f.weekdays[WEEKDAYS[d.weekday]]}
                </label>
                {d.open ? (
                  <>
                    <label>
                      {f.from}
                      <input type="time" value={d.start} onChange={(e) => setDay(d.weekday, { start: e.target.value })} />
                    </label>
                    <label>
                      {f.until}
                      <input type="time" value={d.end} onChange={(e) => setDay(d.weekday, { end: e.target.value })} />
                    </label>
                  </>
                ) : (
                  <span className="muted">{f.dayClosed}</span>
                )}
              </div>
            ))}
          </fieldset>
          <p className="muted campaign-hint">{f.hoursHint}</p>
          <label>
            {f.sendGap}
            <input
              type="number"
              min={CAMPAIGN_SEND_GAP_MIN_MS / 1000}
              max={CAMPAIGN_SEND_GAP_MAX_MS / 1000}
              step={1}
              value={gapSeconds}
              onChange={(e) => (setGapSeconds(e.target.value), touch())}
            />
          </label>
        </details>

        {message && !message.ok ? <p className="campaign-error">{message.text}</p> : null}
        {toast ? <Toast text={toast} onDone={() => setToast(null)} /> : null}
        <div className="field-form-actions">
          <button type="submit" className="btn-secondary" disabled={busy !== ""} aria-busy={busy === "save"}>
            {busy === "save" ? f.saving : live ? f.save : f.saveDraft}
          </button>
        </div>
      </form>

      {id && !live ? (
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
                        {reason === "not_allowlisted" ? (
                          <button type="button" className="btn-secondary campaign-allow" disabled={busy !== ""} onClick={() => void openPicker("allow")}>
                            {copy.confirm.allowAdd}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p>{fillUi(copy.confirm.cost, { usd: preview.costUsd.toFixed(2) })}</p>
              <p className="muted campaign-hint">{copy.confirm.costHint}</p>
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

      {picker ? (
        <PersonDialog
          mode={picker.mode}
          campaignId={picker.campaignId}
          params={specs}
          copy={copy}
          onClose={() => setPicker(null)}
          onAllowed={() => void check(picker.campaignId)}
        />
      ) : null}
    </div>
  );
}
