"use client";

import { INTRO_FIELD_TOKENS } from "@/lib/flow/intro-fields";

/** Inserts `{{name}}`, `{{phone}}`, or `{{email}}` into an intro. */
export function IntroFieldChips({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="token-chips">
      {INTRO_FIELD_TOKENS.map((key) => (
        <button key={key} type="button" onClick={() => onInsert(`{{${key}}}`)}>
          {`{{${key}}}`}
        </button>
      ))}
    </div>
  );
}
