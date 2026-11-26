"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/Select";
import { Icon } from "@/components/crm/Icon";
import {
  composeTemplate,
  previewText,
  templateVariables,
  validateTemplate,
  type TemplateCategory,
  type TemplateLanguage,
} from "@/lib/campaigns/templates";
import type { TemplateRow } from "@/lib/campaigns/store";
import { fillUi, type UiCopy, type UiLang } from "@/lib/ui";

type Copy = UiCopy["campaigns"];
type ErrorKey = keyof Copy["errors"];

/** Campaign templates are marketing only, so every one carries the locked additions. */
const category: TemplateCategory = "MARKETING";
const LANGUAGES = ["he", "en"] as const;

const STATUS_TONE: Record<string, string> = {
  REJECTED: "badge-warn",
  FAILED: "badge-warn",
  PAUSED: "badge-warn",
  DISABLED: "badge-warn",
};

export function CampaignTemplates({
  copy,
  lang,
  initialTermsAccepted,
  adPrefixEnabled,
  business,
  whatsappPhone,
}: {
  copy: Copy;
  lang: UiLang;
  initialTermsAccepted: boolean;
  adPrefixEnabled: boolean;
  business: { name: string; phone: string };
  /** Tenant's own connected number, or null when none is connected. */
  whatsappPhone: string | null;
}) {
  const [accepted, setAccepted] = useState(initialTermsAccepted);
  const [accepting, setAccepting] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<TemplateLanguage>(lang);
  const [body, setBody] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const languageOptions = useMemo(() => LANGUAGES.map((l) => ({ value: l, label: copy.languageNames[l] })), [copy]);

  const errorText = (key: string) => copy.errors[key as ErrorKey] ?? copy.errors.failed;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns/templates", { cache: "no-store" });
      const data = (await res.json()) as { templates?: TemplateRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "failed");
      setTemplates(data.templates ?? []);
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : "failed"));
      setTemplates([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (accepted) void load();
  }, [accepted, load]);

  const open = templates?.find((t) => t.id === openId) ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const draft = { title, category, language, body, examples };
  const composed = useMemo(
    () => composeTemplate({ category, language, body }, { adPrefixEnabled, businessName: business.name, businessPhone: business.phone }),
    [language, body, adPrefixEnabled, business.name, business.phone],
  );
  const issues = validateTemplate(draft, composed);
  const vars = templateVariables(body);

  function setExample(i: number, value: string) {
    setExamples((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }

  function addVariable() {
    const n = Math.max(0, ...vars) + 1;
    const el = bodyRef.current;
    const token = `{{${n}}}`;
    if (!el) {
      setBody((b) => `${b}${token}`);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(`${body.slice(0, start)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns/terms", { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "failed");
      setAccepted(true);
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : "failed"));
    } finally {
      setAccepting(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, category, language, body, examples: examples.slice(0, vars.length) }),
      });
      const data = (await res.json().catch(() => ({}))) as { template?: TemplateRow; error?: string; issues?: string[] };
      if (!res.ok || !data.template) {
        // A failed submit is still saved, so the owner sees it in the list with the reason.
        if (data.error === "submit_failed" && data.template) setTemplates((prev) => [data.template!, ...(prev ?? [])]);
        if (data.error === "invalid" && data.issues?.length) {
          setError(data.issues.map((i) => copy.issues[i as keyof Copy["issues"]] ?? i).join(" "));
        } else {
          setError(errorText(data.error ?? "failed"));
        }
        return;
      }
      setTemplates((prev) => [data.template!, ...(prev ?? [])]);
      setTitle("");
      setBody("");
      setExamples([]);
      setTouched(false);
      setNotice(copy.submitted);
      setCreating(false);
    } catch {
      setError(copy.errors.failed);
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }

  if (!whatsappPhone) return <div className="status-banner warn">{copy.noWhatsApp}</div>;

  if (!accepted) {
    return (
      <section className="card campaign-card form-narrow">
        <h2>{copy.termsTitle}</h2>
        <ul className="campaign-terms">
          {copy.termsBody.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {error ? <p className="campaign-error">{error}</p> : null}
        <button type="button" className="btn" disabled={accepting} aria-busy={accepting} onClick={() => void accept()}>
          {accepting ? copy.termsAccepting : copy.termsAccept}
        </button>
      </section>
    );
  }

  const shownIssues = touched ? issues : [];
  const previewBody = previewText(composed.text, examples);

  function showForm() {
    setCreating(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function oneLine(text: string) {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
  }

  return (
    <div className="campaign-page">
      <p className="muted">{fillUi(copy.whatsappFrom, { phone: whatsappPhone })}</p>
      {notice ? <p className="muted">{notice}</p> : null}

      <section className="card campaign-card">
        <header className="digest-card-head">
          <h2>{copy.templatesTitle}</h2>
          <div className="field-form-actions">
            <button type="button" className="btn" onClick={showForm}>
              {copy.newTemplate}
            </button>
            <button type="button" className="btn-ghost" onClick={() => void load()}>
              {copy.refresh}
            </button>
          </div>
        </header>
        {templates === null ? (
          <p className="muted">…</p>
        ) : templates.length === 0 ? (
          <p className="muted">{copy.templatesEmpty}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.fieldTitle}</th>
                  <th>{copy.statusHeading}</th>
                  <th>{copy.fieldBody}</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button type="button" className="campaign-template-open" onClick={() => setOpenId(t.id)}>
                        {t.title}
                      </button>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_TONE[t.status] ?? ""}`}>
                        {copy.status[t.status as keyof Copy["status"]] ?? t.status}
                      </span>
                    </td>
                    <td className="muted" dir={t.language === "he" ? "rtl" : "ltr"}>
                      {oneLine(t.text || t.body)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating ? (
      <section className="card campaign-card" ref={formRef}>
        <h2>{copy.newTemplate}</h2>
        <div className="digest-settings-grid">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (issues.length === 0) setConfirming(true);
            }}
          >
            <label>
              <span>{copy.fieldTitle}</span>
              <input value={title} maxLength={80} placeholder={copy.fieldTitleHint} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="campaign-row">
              <label>
                <span>{copy.fieldLanguage}</span>
                <Select
                  value={language}
                  ariaLabel={copy.fieldLanguage}
                  options={languageOptions}
                  onChange={(v) => setLanguage(v as TemplateLanguage)}
                />
              </label>
            </div>
            <label>
              <span>{copy.fieldBody}</span>
              <textarea
                ref={bodyRef}
                rows={6}
                value={body}
                dir={language === "he" ? "rtl" : "ltr"}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <p className="muted campaign-hint">{copy.fieldBodyHint}</p>
            <div>
              <button type="button" className="btn-secondary" onClick={addVariable}>
                {copy.addVariable}
              </button>
            </div>
            {vars.map((n, i) => (
              <label key={n}>
                <span>{fillUi(copy.exampleFor, { var: `{{${n}}}` })}</span>
                <input value={examples[i] ?? ""} onChange={(e) => setExample(i, e.target.value)} />
              </label>
            ))}
            <p className="muted campaign-hint">{copy.lockedNote}</p>
            {shownIssues.length > 0 ? (
              <ul className="campaign-error campaign-issues">
                {shownIssues.map((i) => (
                  <li key={i}>{copy.issues[i]}</li>
                ))}
              </ul>
            ) : null}
            {error ? <p className="campaign-error">{error}</p> : null}
            {notice ? <p className="muted">{notice}</p> : null}

            {confirming ? (
              <div className="campaign-confirm" role="group" aria-label={copy.confirmTitle}>
                <strong>{copy.confirmTitle}</strong>
                <p className="muted">{copy.confirmBody}</p>
                <div className="field-form-actions">
                  <button type="button" className="btn" disabled={submitting} aria-busy={submitting} onClick={() => void submit()}>
                    {submitting ? copy.submitting : copy.confirm}
                  </button>
                  <button type="button" className="btn-ghost" disabled={submitting} onClick={() => setConfirming(false)}>
                    {copy.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="field-form-actions">
                <button type="submit" className="btn">
                  {copy.submit}
                </button>
              </div>
            )}
          </form>

          <figure className="digest-preview">
            <figcaption className="muted">{copy.preview}</figcaption>
            <div className="digest-chat" dir={language === "he" ? "rtl" : "ltr"}>
              <div className="digest-bubble">
                <p className="digest-bubble-body">{previewBody || "…"}</p>
                {composed.footer ? <p className="digest-bubble-footer">{composed.footer}</p> : null}
              </div>
              {composed.buttons.map((b) => (
                <div className="digest-bubble-button campaign-bubble-button" key={b}>
                  {b}
                </div>
              ))}
            </div>
          </figure>
        </div>
      </section>
      ) : null}

      {open ? (
        <dialog
          ref={dialogRef}
          className="cl-sheet"
          aria-labelledby="template-view-title"
          onClose={() => setOpenId(null)}
          onClick={(event) => {
            if (event.target === dialogRef.current) dialogRef.current?.close();
          }}
        >
          <div className="cl-sheet-body">
            <header className="cl-sheet-head">
              <h2 id="template-view-title">{open.title}</h2>
              <button type="button" className="btn-icon" aria-label={copy.close} onClick={() => dialogRef.current?.close()}>
                <Icon name="x" />
              </button>
            </header>
            <p className="muted campaign-template-meta">
              <span className={`badge ${STATUS_TONE[open.status] ?? ""}`}>
                {copy.status[open.status as keyof Copy["status"]] ?? open.status}
              </span>
              {" · "}
              {copy.categoryNames[open.category as keyof Copy["categoryNames"]] ?? open.category}
              {" · "}
              {copy.languageNames[open.language as TemplateLanguage] ?? open.language}
            </p>
            <p className="campaign-template-text campaign-confirm" dir={open.language === "he" ? "rtl" : "ltr"}>
              {open.text || open.body}
            </p>
            {open.footer ? <p className="muted">{open.footer}</p> : null}
            {open.statusReason ? <p className="campaign-error">{open.statusReason}</p> : null}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
