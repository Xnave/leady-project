"use client";

import { useState } from "react";
import type { UiCopy } from "@/lib/ui";
import { DEFAULT_TIME, dateTimeAt, presetAt } from "./format";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

const DAYS = [1, 3, 7] as const;

/**
 * Next step: optional text, a time (09:00 by default) and a day. A preset day saves in
 * one tap at the chosen time; "Pick a date" opens a date field with Save. Enter in the
 * text field picks "tomorrow".
 */
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
  onPick: (at: string, text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [pickDate, setPickDate] = useState(false);
  const [date, setDate] = useState("");
  const commit = (at: string | null) => {
    if (!at) return;
    onClose();
    onPick(at, text.trim());
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
              commit(presetAt(1, new Date(), time));
            }
          }}
        />
        <label className="crm-pop-time">
          <span>{ui.crm.nextTime}</span>
          <input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value || DEFAULT_TIME)} />
        </label>
      </div>
      {DAYS.map((d, i) => (
        <button key={d} type="button" role="menuitem" className="crm-pop-item crm-pop-item-ic" onClick={() => commit(presetAt(d, new Date(), time))}>
          <Icon name="cal" small />
          {ui.crm.nextPresets[i]}
        </button>
      ))}
      {pickDate ? (
        <div className="crm-pop-form crm-pop-date">
          <input type="date" value={date} autoFocus aria-label={ui.crm.nextPickDate} onChange={(e) => setDate(e.target.value)} />
          <button type="button" className="crm-btn-quiet" disabled={!date} onClick={() => commit(dateTimeAt(date, time))}>
            {ui.crm.nextSave}
          </button>
        </div>
      ) : (
        <button type="button" role="menuitem" className="crm-pop-item crm-pop-item-ic" onClick={() => setPickDate(true)}>
          <Icon name="calPlus" small />
          {ui.crm.nextPickDate}…
        </button>
      )}
    </Popover>
  );
}
