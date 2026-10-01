"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { UiCopy } from "@/lib/ui";

export type LeadTab = "chat" | "activity" | "details";
const TABS: LeadTab[] = ["chat", "activity", "details"];

/**
 * Conversation / Activity / Details. Arrow keys (flipped in RTL), Home and End move
 * between tabs, following the ARIA tabs pattern.
 */
export function LeadTabs({
  tab,
  onTab,
  ui,
  panels,
  hide,
}: {
  tab: LeadTab;
  onTab: (t: LeadTab) => void;
  ui: UiCopy;
  panels: Record<LeadTab, () => ReactNode>;
  /** Tabs to leave out (the full page shows details in its side column). */
  hide?: LeadTab[];
}) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const tabs = TABS.filter((t) => !hide?.includes(t));
  const current = tabs.includes(tab) ? tab : tabs[0];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const i = tabs.indexOf(current);
    const n = tabs.length;
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "ArrowRight") next = (i + (rtl ? -1 : 1) + n) % n;
    else if (e.key === "ArrowLeft") next = (i + (rtl ? 1 : -1) + n) % n;
    else return;
    e.preventDefault();
    const t = tabs[next];
    onTab(t);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${t}"]`)?.focus();
  };

  return (
    <>
      <div ref={listRef} className="crm-lv-tabs" role="tablist" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${id}-t-${t}`}
            data-tab={t}
            className="crm-tab"
            aria-selected={t === current}
            aria-controls={`${id}-p`}
            tabIndex={t === current ? 0 : -1}
            onClick={() => onTab(t)}
          >
            {ui.crm.tabsLead[t]}
          </button>
        ))}
      </div>
      <div id={`${id}-p`} role="tabpanel" aria-labelledby={`${id}-t-${current}`} className={`crm-lv-panel crm-lv-panel-${current}`}>
        {panels[current]()}
      </div>
    </>
  );
}
