"use client";

import { useState } from "react";
import type { LeadViewDTO } from "@/lib/crm/view";
import { isPipelineStage } from "@/lib/crm/types";
import { fillUi, type UiCopy } from "@/lib/ui";
import { hitlReasonLabel } from "@/lib/ui/labels";
import { absTime, type Clock } from "./format";
import { Icon, type IconName } from "./Icon";
import { autoReasonKey, clockTime, dayLabel, TIMELINE_FILTERS, timelineMatches, type TimelineFilter } from "./lead-view";
import { stageLabel } from "./StageMenu";

type Lang = "he" | "en";
type Item = LeadViewDTO["timeline"][number]["items"][number];
type Line = { icon: IconName; accent?: boolean; title: string; sub?: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One timeline item as an icon, a sentence and an optional detail line. */
function describe(it: Item, ui: UiCopy, lang: Lang, wonLabel: string, clock: Clock | null): Line {
  const t = ui.crm.timeline;
  const d = it.data;
  const actor = str(d.actor) || str(d.author);
  const stage = (v: unknown) => (isPipelineStage(v) ? stageLabel(ui, wonLabel, v) : str(v));
  switch (it.kind) {
    case "stage": {
      const manual = d.source === "manual";
      const to = stage(d.to);
      const arrow = lang === "he" ? " ← " : " → ";
      const key = manual ? null : autoReasonKey(str(d.reason));
      const why = manual ? str(d.reason) : key ? `${ui.crm.auto} · ${ui.crm.autoReasons[key]}` : ui.crm.auto;
      return {
        icon: "flag",
        accent: true,
        title: manual && actor ? fillUi(t.stageManual, { actor, stage: to }) : fillUi(t.stageAuto, { stage: to }),
        sub: [d.from ? `${stage(d.from)}${arrow}${to}` : "", why].filter(Boolean).join(" · "),
      };
    }
    case "note":
      return { icon: "note", title: fillUi(t.note, { actor }), sub: str(d.body) };
    case "next_step":
      return d.action === "next_step_done"
        ? { icon: "check", title: fillUi(t.nextDone, { actor }) }
        : { icon: "bell", title: fillUi(t.nextSet, { actor }), sub: str(d.text) };
    case "snooze":
      // Timezone-dependent: only once the client clock is mounted.
      return { icon: "clock", title: fillUi(t.snooze, { actor, when: clock && d.until ? absTime(str(d.until), lang) : "" }) };
    case "request": {
      const ev = str(d.event);
      if (ev === "created") return { icon: "cal", accent: true, title: t.requestCreated, sub: str(d.timeText) };
      const key = ev === "approve" ? "requestApprove" : ev === "decline" ? "requestDecline" : "requestReschedule";
      return { icon: "cal", title: fillUi(t[key], { actor }) };
    }
    case "handoff":
      return d.event === "resolved"
        ? { icon: "check", title: t.handoffResolved }
        : { icon: "hand", title: t.handoffOpened, sub: d.reason ? hitlReasonLabel(ui, str(d.reason)) : undefined };
    case "conversation":
      return { icon: "msg", title: d.event === "ended" ? t.convoEnded : t.convoStarted };
  }
}

/** The activity timeline with kind filters and day headers (today / yesterday / date). */
export function LeadTimeline({
  timeline,
  ui,
  lang,
  clock,
  wonLabel,
}: {
  timeline: LeadViewDTO["timeline"];
  ui: UiCopy;
  lang: Lang;
  clock: Clock | null;
  wonLabel: string;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const days = { today: ui.crm.timeline.today, yesterday: ui.crm.timeline.yesterday };
  const groups = timeline
    .map((g) => ({ day: g.day, items: g.items.filter((it) => timelineMatches(it.kind, filter)) }))
    .filter((g) => g.items.length);

  return (
    <div className="crm-tl">
      <div className="crm-tl-filters" role="group" aria-label={ui.crm.tabsLead.activity}>
        {TIMELINE_FILTERS.map((f) => (
          <button key={f} type="button" className="crm-fchip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {ui.crm.timelineFilters[f]}
          </button>
        ))}
      </div>
      {groups.length ? (
        groups.map((g) => (
          <section key={g.day} className="crm-tl-group">
            <h3 className="crm-tl-day">{clock ? dayLabel(g.day, clock.now, lang, days) : "\u00a0"}</h3>
            <ol className="crm-tl-list">
              {g.items.map((it) => {
                const line = describe(it, ui, lang, wonLabel, clock);
                return (
                  <li key={it.id} className="crm-tl-item">
                    <span className={line.accent ? "crm-tl-ic acc" : "crm-tl-ic"} aria-hidden="true">
                      <Icon name={line.icon} small />
                    </span>
                    <span className="crm-tl-t">
                      {line.title}
                      {line.sub ? <small>{line.sub}</small> : null}
                    </span>
                    <time className="crm-tl-time" dateTime={it.at}>
                      {clock ? clockTime(it.at, lang) : null}
                    </time>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      ) : (
        <p className="crm-tl-empty">{ui.crm.emptyTitle}</p>
      )}
    </div>
  );
}
