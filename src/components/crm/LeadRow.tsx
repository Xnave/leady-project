"use client";

import { memo, type MouseEvent } from "react";
import type { LeadRowDTO } from "@/lib/crm/view";
import { isActiveStage } from "@/lib/crm/types";
import { fillUi, type UiCopy } from "@/lib/ui";
import { absTime, initials, relTime, untilTime } from "./format";
import { Icon, type IconName } from "./Icon";
import { isSnoozable } from "./rows";
import { stageLabel } from "./StageMenu";

export type RowMenu = "stage" | "next" | "snooze";
type Lang = "he" | "en";

const FU_ICON: Record<NonNullable<LeadRowDTO["followUpReason"]>, IconName> = {
  handoff: "hand",
  approval: "clock",
  reminder: "bell",
  cold: "cold",
};

function FollowUp({ r, ui, lang, now }: { r: LeadRowDTO; ui: UiCopy; lang: Lang; now: Date }) {
  if (r.snoozedUntil && new Date(r.snoozedUntil) > now) {
    return (
      <span className="crm-fu crm-fu-cold" suppressHydrationWarning>
        <Icon name="clock" small />
        {ui.crm.snooze} · {untilTime(r.snoozedUntil, lang, now)}
      </span>
    );
  }
  if (r.due && r.followUpReason) {
    const age =
      r.followUpReason === "reminder" || !r.followUpAt ? ui.crm.timeline.today : relTime(r.followUpAt, lang, now);
    return (
      <span className={`crm-fu crm-fu-${r.followUpReason}`}>
        <Icon name={FU_ICON[r.followUpReason]} small />
        {ui.crm.reasons[r.followUpReason]}
        <span className="crm-fu-age" suppressHydrationWarning>· {age}</span>
      </span>
    );
  }
  if (r.nextStepAt) {
    return (
      <span className="crm-fu-none" title={absTime(r.nextStepAt, lang)} suppressHydrationWarning>
        <Icon name="bell" small /> {untilTime(r.nextStepAt, lang, now)}
      </span>
    );
  }
  return <span className="crm-fu-none">—</span>;
}

function LastContact({ r, ui, lang, now }: { r: LeadRowDTO; ui: UiCopy; lang: Lang; now: Date }) {
  let win = null;
  if (r.channel === "whatsapp" && isActiveStage(r.stage)) {
    if (r.windowClosed) win = <span className="crm-win">{ui.crm.windowClosed}</span>;
    else if (r.windowHoursLeft != null && r.windowHoursLeft <= 3)
      win = (
        <span className="crm-win warn">
          <Icon name="clock" small />
          {fillUi(ui.crm.windowLeft, { h: r.windowHoursLeft })}
        </span>
      );
  }
  return (
    <span className="crm-last" role="gridcell">
      <span className="crm-last-t">
        <b title={absTime(r.lastAt, lang)} suppressHydrationWarning>
          {relTime(r.lastAt, lang, now)}
        </b>
        {" · "}
        {r.lastBy === "them" ? ui.crm.them : ui.crm.us}
      </span>
      {win}
    </span>
  );
}

/**
 * Time text renders against the server's `now` first and re-renders on the client
 * right after mount (browser clock and timezone), hence `suppressHydrationWarning`.
 */
type Props = {
  row: LeadRowDTO;
  kb: boolean;
  checked: boolean;
  leaving: boolean;
  ui: UiCopy;
  lang: Lang;
  wonLabel: string;
  now: Date;
  onOpen: (id: string) => void;
  onCheck: (id: string, on: boolean) => void;
  onMenu: (kind: RowMenu, id: string, anchor: HTMLElement) => void;
};

export const LeadRow = memo(function LeadRow({ row: r, kb, checked, leaving, ui, lang, wonLabel, now, onOpen, onCheck, onMenu }: Props) {
  const cls = ["crm-row", r.unread && "unread", kb && "kb", checked && "checked", leaving && "leaving"]
    .filter(Boolean)
    .join(" ");
  const onRowClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, input, a, label")) return;
    onOpen(r.id);
  };
  const menu = (kind: RowMenu) => (e: MouseEvent<HTMLButtonElement>) => onMenu(kind, r.id, e.currentTarget);

  return (
    <div className={cls} role="row" aria-selected={checked} data-row={r.id} tabIndex={-1} onClick={onRowClick}>
      <span className="crm-col-cb" role="gridcell">
        <input
          type="checkbox"
          className="crm-cb"
          checked={checked}
          onChange={(e) => onCheck(r.id, e.target.checked)}
          aria-label={r.name}
        />
      </span>
      <span className="crm-who" role="gridcell">
        <span className="crm-av" aria-hidden="true">
          {initials(r.name)}
          <span className={`crm-av-ch ${r.channel === "whatsapp" ? "wa" : "ig"}`} />
        </span>
        <span className="crm-who-t">
          <span className="crm-name">
            {r.unread ? <span className="crm-udot" /> : null}
            <bdi className="crm-name-t">{r.name}</bdi>
            {r.demo ? <span className="badge badge-demo">{ui.common.demo}</span> : null}
          </span>
          <span className="crm-handle">
            <span className="ltr-isolate">{r.handle}</span>
          </span>
        </span>
      </span>
      <span className="crm-col-stage" role="gridcell">
        <button
          type="button"
          className={`crm-stage crm-s-${r.stage}`}
          data-stage-btn=""
          aria-haspopup="menu"
          aria-label={`${ui.crm.cols.stage}: ${stageLabel(ui, wonLabel, r.stage)}`}
          onClick={menu("stage")}
        >
          <span className="crm-sdot" />
          {stageLabel(ui, wonLabel, r.stage)}
          <Icon name="down" small />
        </button>
      </span>
      <span className="crm-stand" role="gridcell">
        {r.nextStepText ? (
          <span className="crm-stand-next">
            <Icon name="flag" small />
            <bdi>{r.nextStepText}</bdi>
          </span>
        ) : (
          <bdi>{r.stand}</bdi>
        )}
      </span>
      <span className="crm-col-fu" role="gridcell">
        <FollowUp r={r} ui={ui} lang={lang} now={now} />
      </span>
      <LastContact r={r} ui={ui} lang={lang} now={now} />
      <span className="crm-row-actions" role="gridcell">
        <button type="button" className="crm-ibtn" aria-label={ui.crm.message} title={ui.crm.message} onClick={() => onOpen(r.id)}>
          <Icon name="msg" />
        </button>
        <button
          type="button"
          className="crm-ibtn"
          aria-label={ui.crm.nextStep}
          title={`${ui.crm.nextStep} (n)`}
          aria-haspopup="menu"
          onClick={menu("next")}
        >
          <Icon name="flag" />
        </button>
        {isSnoozable(r) ? (
          <button
            type="button"
            className="crm-ibtn"
            aria-label={ui.crm.snooze}
            title={`${ui.crm.snooze} (z)`}
            aria-haspopup="menu"
            onClick={menu("snooze")}
          >
            <Icon name="clock" />
          </button>
        ) : null}
      </span>
    </div>
  );
});
