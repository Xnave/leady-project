"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { BuiltinPresetId } from "@/lib/persona/presets";
import { PREVIEW_SAMPLES, type SampleId } from "@/lib/persona/samples";
import type { Persona } from "@/lib/persona/types";
import type { UiCopy } from "@/lib/ui";
import { PersonaControls } from "./PersonaControls";
import { PersonaPreview, type PreviewSample, type PreviewState } from "./PersonaPreview";
import { PresetGallery } from "./PresetGallery";
import {
  cleanDraft,
  draftReducer,
  isDirty,
  issuesToFieldErrors,
  previewWait,
  type DraftAction,
  type IssueCode,
} from "./persona-draft";

function previewKey(p: Persona, lang: string) {
  return JSON.stringify(cleanDraft(p)) + lang;
}

/** Owner-facing persona editor: pick a preset, tune it, hear it, save. */
export function PersonaStudio({
  initial,
  ui,
  businessName,
  defaultPreviewLang,
}: {
  initial: Persona;
  ui: UiCopy["persona"];
  businessName: string;
  defaultPreviewLang: "en" | "he";
}) {
  const [saved, setSaved] = useState(initial);
  const [draft, dispatch] = useReducer(draftReducer, initial);
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [previewLang, setPreviewLang] = useState(defaultPreviewLang);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [ruleErrors, setRuleErrors] = useState<Record<number, IssueCode>>({});
  const [nameError, setNameError] = useState<IssueCode | undefined>();
  const lastPreviewed = useRef("");
  const lastPreviewStart = useRef<number | undefined>(undefined);
  const dirty = isDirty(saved, draft);

  const sampleCustomer = useMemo(
    () =>
      Object.fromEntries(PREVIEW_SAMPLES[previewLang].map((s) => [s.id, s.customer])) as Record<SampleId, string>,
    [previewLang],
  );

  // Fade the preview once the draft moves away from what was last heard.
  useEffect(() => {
    setPreview((p) => (p.kind === "ready" ? { ...p, stale: previewKey(draft, previewLang) !== lastPreviewed.current } : p));
  }, [draft, previewLang]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  function showIssues(p: Persona, body: unknown) {
    const issues = (body as { issues?: Parameters<typeof issuesToFieldErrors>[1] })?.issues ?? [];
    const mapped = issuesToFieldErrors(p, issues);
    setRuleErrors(mapped.rules);
    setNameError(mapped.name);
  }

  // Editing a row clears its error; structural edits (add/remove/reset) clear all.
  function edit(a: DraftAction) {
    if (a.type === "editRule") {
      setRuleErrors((e) => {
        const next = { ...e };
        delete next[a.index];
        return next;
      });
    } else if (a.type === "name") {
      setNameError(undefined);
    } else if (a.type === "removeRule" || a.type === "reset") {
      setRuleErrors({});
    }
    dispatch(a);
  }

  async function runPreview(p: Persona = draft) {
    const previous =
      preview.kind === "ready" ? preview.samples : preview.kind === "error" ? preview.previous : undefined;
    setPreview({ kind: "loading", previous });
    const wait = previewWait(lastPreviewStart.current, Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastPreviewStart.current = Date.now();
    try {
      const res = await fetch("/api/agent/persona/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona: cleanDraft(p), lang: previewLang }),
      });
      if (res.status === 409) return setPreview({ kind: "no_llm" });
      if (res.status === 429) return setPreview({ kind: "error", message: ui.previewSlowDown, previous });
      // 503 = the model call failed (usually provider quota), not a bug in the page.
      if (res.status === 503) return setPreview({ kind: "error", message: ui.previewQuota, previous });
      if (res.status === 400) {
        showIssues(p, await res.json().catch(() => null));
        return setPreview({ kind: "error", message: ui.previewFixRules, previous });
      }
      if (!res.ok) return setPreview({ kind: "error", message: ui.previewFailed, previous });
      const body = (await res.json()) as { samples: PreviewSample[] };
      lastPreviewed.current = previewKey(p, previewLang);
      setPreview({ kind: "ready", samples: body.samples, stale: false });
    } catch {
      setPreview({ kind: "error", message: ui.previewFailed, previous });
    }
  }

  function pickPreset(id: BuiltinPresetId) {
    const next = draftReducer(draft, { type: "preset", id });
    dispatch({ type: "preset", id });
    if (preview.kind !== "loading" && preview.kind !== "no_llm") void runPreview(next);
  }

  async function save() {
    setSaving(true);
    setRuleErrors({});
    setNameError(undefined);
    try {
      const res = await fetch("/api/agent/persona", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona: cleanDraft(draft) }),
      });
      if (res.status === 400) {
        showIssues(draft, await res.json().catch(() => null));
        setToast({ text: ui.saveFailed, ok: false });
        return;
      }
      if (!res.ok) {
        setToast({ text: ui.saveFailed, ok: false });
        return;
      }
      const { persona } = (await res.json()) as { persona: Persona };
      setSaved(persona);
      dispatch({ type: "reset", persona });
      setToast({ text: ui.saved, ok: true });
    } catch {
      setToast({ text: ui.saveFailed, ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="persona-studio">
      <div className="persona-main">
        <section className="persona-step">
          <h2>
            <span className="persona-step-num">1</span>
            {ui.stepStyle}
            {draft.presetId === "custom" ? <span className="persona-custom-badge">{ui.customBadge}</span> : null}
          </h2>
          <PresetGallery value={draft.presetId} onPick={pickPreset} ui={ui} sampleLang={previewLang} />
        </section>
        <section className="persona-step">
          <h2>
            <span className="persona-step-num">2</span>
            {ui.stepTune}
          </h2>
          <PersonaControls p={draft} dispatch={edit} ui={ui} ruleErrors={ruleErrors} nameError={nameError} />
        </section>
      </div>

      <section className="persona-step persona-side">
        <h2>
          <span className="persona-step-num">3</span>
          {ui.stepPreview}
        </h2>
        <PersonaPreview
          state={preview}
          onRun={() => void runPreview()}
          ui={ui}
          agentName={draft.agentName.trim()}
          businessName={businessName}
          lang={previewLang}
          onLang={setPreviewLang}
          sampleCustomer={sampleCustomer}
        />
      </section>

      <div className={`persona-savebar${dirty ? " show" : ""}`} aria-hidden={!dirty} inert={!dirty || undefined}>
        <span>{ui.unsaved}</span>
        <button type="button" className="btn-ghost" onClick={() => edit({ type: "reset", persona: saved })}>
          {ui.discard}
        </button>
        <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
          {saving ? ui.saving : ui.save}
        </button>
      </div>
      {toast ? (
        <div className={`persona-toast${toast.ok ? "" : " bad"}`} role="status">
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
