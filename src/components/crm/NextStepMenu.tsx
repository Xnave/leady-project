"use client";

import { useState } from "react";
import type { UiCopy } from "@/lib/ui";
import type { SnoozeDays } from "./crm-client";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

const DAYS: SnoozeDays[] = [1, 3, 7];

/** Next step: optional text plus a preset day (09:00 local). Enter in the text field picks "tomorrow". */
export function NextStepMenu({
  anchor,
  returnFocus,
  initialText,
  ui,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  returnFocus?: HTMLElement | null;
  initialText: string;
  ui: UiCopy;
  onPick: (days: SnoozeDays, text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const pick = (d: SnoozeDays) => {
    onClose();
    onPick(d, text.trim());
  };
  return (
    <Popover anchor={anchor} returnFocus={returnFocus} label={ui.crm.nextStep} onClose={onClose}>
      <h6>{ui.crm.nextStep}</h6>
      <div className="crm-pop-form">
        <input
          type="text"
          value={text}
          maxLength={300}
          placeholder={ui.crm.nextPlaceholder}
          aria-label={ui.crm.nextStep}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              pick(1);
            }
          }}
        />
      </div>
      {DAYS.map((d, i) => (
        <button key={d} type="button" role="menuitem" className="crm-pop-item" onClick={() => pick(d)}>
          <Icon name="cal" small />
          {ui.crm.nextPresets[i]}
        </button>
      ))}
    </Popover>
  );
}
