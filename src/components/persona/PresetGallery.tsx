"use client";

import { PRESETS, type BuiltinPresetId } from "@/lib/persona/presets";
import { PRESET_SAMPLE_REPLY } from "@/lib/persona/samples";
import type { PresetId } from "@/lib/persona/types";
import type { UiCopy } from "@/lib/ui";

const PRESET_IDS = Object.keys(PRESETS) as BuiltinPresetId[];

/** Preset cards with a sample reply each, so the voices differ visibly before any live preview. */
export function PresetGallery({
  value,
  onPick,
  ui,
  sampleLang,
}: {
  value: PresetId;
  onPick: (id: BuiltinPresetId) => void;
  ui: UiCopy["persona"];
  sampleLang: "en" | "he";
}) {
  return (
    <div className="persona-presets" role="radiogroup" aria-label={ui.stepStyle}>
      {PRESET_IDS.map((id) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`persona-preset${on ? " on" : ""}`}
            onClick={() => onPick(id)}
          >
            <span className="persona-preset-head">
              <strong>{ui.presets[id].name}</strong>
              <span className="persona-check" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </span>
            <span className="persona-preset-tag">{ui.presets[id].tagline}</span>
            <span className="persona-bubble agent mini" dir={sampleLang === "he" ? "rtl" : "ltr"}>
              {PRESET_SAMPLE_REPLY[sampleLang][id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
