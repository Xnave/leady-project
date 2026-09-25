"use client";

import { useState } from "react";
import type { UiCopy } from "@/lib/ui";
import { absTime, presetAt, untilTime, type Clock } from "./format";
import { Icon } from "./Icon";
import { dateInputToIso, isoToDateInput } from "./lead-view";

const PRESETS = [1, 3, 7] as const;

/**
 * The next step: what happens and when. With none set (or while editing) the text is
 * an input; Enter saves it on the current date (tomorrow 09:00 when there is none) and
 * Esc cancels. The presets and the date field set the date and keep the text.
 */
export function NextStepEditor({
  text,
  at,
  ui,
  lang,
  clock,
  onSave,
  onDone,
}: {
  text: string | null;
  at: string | null;
  ui: UiCopy;
  lang: "he" | "en";
  clock: Clock | null;
  onSave: (text: string | null, at: string) => void;
  onDone: () => void;
}) {
  const has = Boolean(at);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  // A saved, cleared or reloaded next step resets the draft.
  const [seen, setSeen] = useState({ text, at });
  if (seen.text !== text || seen.at !== at) {
    setSeen({ text, at });
    setDraft(text ?? "");
    setEditing(false);
  }
  const inputOpen = editing || !has;

  const save = (when: string | null) => {
    const t = (inputOpen ? draft : (text ?? "")).trim() || null;
    const iso = when ?? at ?? presetAt(1);
    setEditing(false);
    onSave(t, iso);
  };
  const startEdit = () => {
    setDraft(text ?? "");
    setEditing(true);
  };
  const cancel = () => {
    setDraft(text ?? "");
    setEditing(false);
  };

  return (
    <section className="crm-sec" aria-label={ui.crm.nextStep}>
      <div className="crm-sec-h">
        <Icon name="flag" small />
        {ui.crm.nextStep}
      </div>
      {inputOpen ? (
        <input
          type="text"
          className="crm-next-input"
          value={draft}
          maxLength={300}
          placeholder={has ? ui.crm.nextPlaceholder : `${ui.crm.noNextStep} ${ui.crm.nextPlaceholder}`}
          aria-label={ui.crm.nextStep}
          autoFocus={editing}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (draft.trim() || has) save(null);
            } else if (e.key === "Escape" && editing) {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          onBlur={() => {
            if (editing && draft.trim() === (text ?? "").trim()) setEditing(false);
          }}
        />
      ) : (
        <div className="crm-next">
          <button type="button" className="crm-next-text" onClick={startEdit} title={ui.crm.nextPlaceholder}>
            <b>{text || ui.crm.nextStep}</b>
            <span title={clock && at ? absTime(at, lang) : undefined}>
              <Icon name="cal" small />
              {clock && at ? untilTime(at, lang, clock.now) : null}
            </span>
          </button>
          <button type="button" className="crm-btn-quiet" onClick={onDone}>
            <Icon name="check" small />
            {ui.crm.markDone}
          </button>
        </div>
      )}
      <div className="crm-presets">
        {PRESETS.map((d, i) => (
          <button key={d} type="button" className="crm-btn-quiet" onMouseDown={(e) => e.preventDefault()} onClick={() => save(presetAt(d))}>
            {ui.crm.nextPresets[i]}
          </button>
        ))}
        <input
          type="date"
          className="crm-next-date"
          aria-label={ui.crm.nextStep}
          value={isoToDateInput(clock ? at : null)}
          onChange={(e) => {
            const iso = dateInputToIso(e.target.value);
            if (iso) save(iso);
          }}
        />
      </div>
    </section>
  );
}
