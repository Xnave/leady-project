"use client";

import type { ReactNode } from "react";
import { PERSONA_LIMITS, type Persona } from "@/lib/persona/types";
import type { UiCopy } from "@/lib/ui";
import { SegmentedControl } from "./SegmentedControl";
import type { DraftAction, IssueCode } from "./persona-draft";

type SetKey = Extract<DraftAction, { type: "set" }>["key"];

function opts<K extends string>(labels: Record<K, string>) {
  return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="persona-row">
      <span className="persona-row-label">{label}</span>
      <div className="persona-row-control">
        {children}
        {hint ? <small className="persona-hint">{hint}</small> : null}
      </div>
    </div>
  );
}

export function PersonaControls({
  p,
  dispatch,
  ui,
  ruleErrors,
  nameError,
}: {
  p: Persona;
  dispatch: (a: DraftAction) => void;
  ui: UiCopy["persona"];
  ruleErrors: Record<number, IssueCode>;
  nameError?: IssueCode;
}) {
  const set = (key: SetKey) => (value: string) => dispatch({ type: "set", key, value });
  const left = PERSONA_LIMITS.rules - p.rules.length;

  return (
    <div className="persona-controls">
      <fieldset className="persona-group">
        <legend>{ui.identity}</legend>
        <Row label={ui.agentName} hint={ui.agentNameHint}>
          <input
            dir="auto"
            aria-invalid={Boolean(nameError)}
            className={nameError ? "persona-invalid" : undefined}
            value={p.agentName}
            maxLength={PERSONA_LIMITS.nameChars}
            placeholder={ui.agentNamePlaceholder}
            aria-label={ui.agentName}
            onChange={(e) => dispatch({ type: "name", value: e.target.value })}
          />
          {nameError ? (
            <small className="persona-error">{nameError === "override" ? ui.nameOverride : ui.issue[nameError]}</small>
          ) : null}
        </Row>
        <Row label={ui.gender} hint={ui.genderHint}>
          <SegmentedControl label={ui.gender} value={p.gender} options={opts(ui.genderOptions)} onChange={set("gender")} />
        </Row>
      </fieldset>

      <fieldset className="persona-group">
        <legend>{ui.style}</legend>
        <Row label={ui.tone}>
          <SegmentedControl label={ui.tone} value={p.tone} options={opts(ui.toneOptions)} onChange={set("tone")} />
        </Row>
        <Row label={ui.length} hint={ui.lengthExample[p.length]}>
          <SegmentedControl label={ui.length} value={p.length} options={opts(ui.lengthOptions)} onChange={set("length")} />
        </Row>
        <Row label={ui.formality}>
          <SegmentedControl
            label={ui.formality}
            value={p.formality}
            options={opts(ui.formalityOptions)}
            onChange={set("formality")}
          />
        </Row>
        <Row label={ui.emoji}>
          <SegmentedControl label={ui.emoji} value={p.emoji} options={opts(ui.emojiOptions)} onChange={set("emoji")} />
        </Row>
        <Row label={ui.questions}>
          <SegmentedControl
            label={ui.questions}
            value={p.questionStyle}
            options={opts(ui.questionOptions)}
            onChange={set("questionStyle")}
          />
        </Row>
      </fieldset>

      <fieldset className="persona-group">
        <legend>{ui.rules}</legend>
        <small className="persona-hint">{ui.rulesHint}</small>
        {p.rules.map((r, i) => (
          <div key={i} className={`persona-rule${ruleErrors[i] ? " invalid" : ""}`}>
            <input
              dir="auto"
              value={r}
              maxLength={PERSONA_LIMITS.ruleChars}
              placeholder={ui.rulePlaceholder}
              aria-label={`${ui.rules} ${i + 1}`}
              aria-invalid={Boolean(ruleErrors[i])}
              onChange={(e) => dispatch({ type: "editRule", index: i, value: e.target.value })}
            />
            <button
              type="button"
              className="btn-ghost persona-rule-remove"
              aria-label={ui.removeRule}
              title={ui.removeRule}
              onClick={() => dispatch({ type: "removeRule", index: i })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            {ruleErrors[i] ? <small className="persona-error">{ui.issue[ruleErrors[i]]}</small> : null}
          </div>
        ))}
        {left > 0 ? (
          <button type="button" className="btn-ghost persona-add" onClick={() => dispatch({ type: "addRule" })}>
            + {ui.addRule}
            <span className="persona-hint">{ui.rulesLeft.replace("{n}", String(left))}</span>
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}
