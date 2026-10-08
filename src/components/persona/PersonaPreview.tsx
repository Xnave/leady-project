"use client";

import { useState } from "react";
import type { SampleId } from "@/lib/persona/samples";
import type { UiCopy } from "@/lib/ui";
import { SegmentedControl } from "./SegmentedControl";

export type PreviewSample = { id: SampleId; customer: string; reply: string };
export type PreviewState =
  | { kind: "idle" }
  | { kind: "loading"; previous?: PreviewSample[] }
  | { kind: "ready"; samples: PreviewSample[]; stale: boolean }
  | { kind: "no_llm" }
  | { kind: "error"; message: string };

const SAMPLE_IDS: SampleId[] = ["pricing", "vague", "complaint"];

/** Phone-style chat that shows real agent replies for three typical customer messages. */
export function PersonaPreview({
  state,
  onRun,
  ui,
  agentName,
  businessName,
  lang,
  onLang,
  sampleCustomer,
}: {
  state: PreviewState;
  onRun: () => void;
  ui: UiCopy["persona"];
  agentName: string;
  businessName: string;
  lang: "en" | "he";
  onLang: (l: "en" | "he") => void;
  sampleCustomer: Record<SampleId, string>;
}) {
  const [tab, setTab] = useState<SampleId>("pricing");
  const loading = state.kind === "loading";
  const samples = state.kind === "ready" ? state.samples : state.kind === "loading" ? state.previous : undefined;
  const current = samples?.find((s) => s.id === tab);
  const stale = state.kind === "ready" && state.stale;

  return (
    <div className="persona-preview">
      <div className="persona-preview-head">
        <div>
          <strong>{ui.previewTitle}</strong>
          <small className="persona-hint">{ui.previewHint}</small>
        </div>
        <SegmentedControl
          label={ui.previewLangToggle}
          size="small"
          value={lang}
          options={[
            { value: "he", label: "עב" },
            { value: "en", label: "EN" },
          ]}
          onChange={onLang}
        />
      </div>

      <div className="persona-tabs" role="tablist">
        {SAMPLE_IDS.map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            className={`persona-tab${tab === id ? " on" : ""}`}
            onClick={() => setTab(id)}
          >
            {ui.previewSamples[id]}
          </button>
        ))}
      </div>

      <div className="persona-phone" dir={lang === "he" ? "rtl" : "ltr"}>
        <div className="persona-phone-bar">
          <span className="persona-avatar" aria-hidden="true">
            {(agentName || businessName).trim().charAt(0).toUpperCase() || "•"}
          </span>
          <span>{agentName || businessName}</span>
        </div>
        <div className={`persona-thread${stale ? " stale" : ""}`} aria-live="polite" aria-busy={loading}>
          <div className="persona-bubble customer">{sampleCustomer[tab]}</div>
          {loading ? (
            <div className="persona-bubble agent typing" aria-label={ui.previewRunning}>
              <i />
              <i />
              <i />
            </div>
          ) : current ? (
            <div className="persona-bubble agent" key={current.reply}>
              {agentName ? <span className="persona-sender">{agentName}</span> : null}
              {current.reply}
            </div>
          ) : null}
        </div>
      </div>

      {state.kind === "no_llm" ? <p className="persona-note">{ui.previewNoLlm}</p> : null}
      {state.kind === "error" ? <p className="persona-note">{state.message}</p> : null}
      {stale ? <p className="persona-note stale">{ui.previewStale}</p> : null}

      <button
        type="button"
        className="btn persona-run"
        disabled={loading || state.kind === "no_llm"}
        onClick={onRun}
      >
        {loading ? ui.previewRunning : ui.previewRun}
      </button>
    </div>
  );
}
