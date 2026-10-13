"use client";

import { useEffect, useRef } from "react";
import type { CrmCounts, CrmTab } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";

const TABS: CrmTab[] = ["needs", "cold", "active", "won", "closed", "all"];
const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
] as const;

/** Tabs (with counts) and the channel filter chips. */
export function ListBar({
  tab,
  channel,
  counts,
  ui,
  onTab,
  onChannel,
}: {
  tab: CrmTab;
  channel?: string;
  counts: CrmCounts;
  ui: UiCopy;
  onTab: (t: CrmTab) => void;
  onChannel: (c: string | undefined) => void;
}) {
  const tabsRef = useRef<HTMLDivElement>(null);
  // On a phone the tabs are a swipe row: keep the selected one in view (e.g. "All" from a link).
  useEffect(() => {
    const row = tabsRef.current;
    if (!row || row.scrollWidth <= row.clientWidth) return;
    row.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  return (
    <div className="crm-bar">
      <div ref={tabsRef} className="crm-tabs" role="tablist" aria-label={ui.page.leadsTitle}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className={t === "needs" || t === "cold" ? `crm-tab ${t}` : "crm-tab"}
            aria-selected={tab === t}
            aria-controls="crm-leads-grid"
            onClick={() => onTab(t)}
          >
            {ui.crm.tabs[t]}
            {counts[t] ? <span className="crm-tab-count">{counts[t]}</span> : null}
          </button>
        ))}
      </div>
      <div className="crm-filters" role="group" aria-label={ui.crm.channelFilter}>
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="crm-fchip"
            aria-pressed={channel === c.id}
            onClick={() => onChannel(channel === c.id ? undefined : c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
