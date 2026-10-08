"use client";

import { memo, type MouseEvent } from "react";
import type { LeadRowDTO } from "@/lib/crm/view";
import { isActiveStage } from "@/lib/crm/types";
import { fillUi, type UiCopy } from "@/lib/ui";
import { absTime, initials, relTime, untilTime, type Clock } from "./format";
import { Icon, type IconName } from "./Icon";
import { avatarDotClass } from "./rows";
import { stageLabel } from "./StageMenu";

/** Tooltip text: the action, then its keyboard shortcut. */
function tip(label: string, key: string): string {
  return `${label} · ${key}`;
}

export type RowMenu = "stage" | "next" | "actions";
type Lang = "he" | "en";

export const FU_ICON: Record<NonNullable<LeadRowDTO["followUpReason"]>, IconName> = {
  handoff: "hand",
  approval: "clock",
  reminder: "bell",
  cold: "cold",
};

function FollowUp({ r, ui, lang, clock }: { r: LeadRowDTO; ui: UiCopy; lang: Lang; clock: Clock }) {
  const { now, local } = clock;
  if (r.snoozedUntil && new Date(r.snoozedUntil) > now) {
    return (
      <span className="crm-fu crm-fu-cold">
        <Icon name="clock" small />
        {ui.crm.snooze}
        {local ? ` · ${untilTime(r.snoozedUntil, lang, now)}` : null}
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
        <span className="crm-fu-age">· {age}</span>
      </span>
    );
  }
  if (r.nextStepAt) {
    return (
      <span className="crm-fu-none" title={local ? absTime(r.nextStepAt, lang) : undefined}>
        <Icon name="bell" small /> {local ? untilTime(r.nextStepAt, lang, now) : null}
      </span>
    );
  }
  return <span className="crm-fu-none">-</span>;
}

function LastContact({ r, ui, lang, clock }: { r: LeadRowDTO; ui: UiCopy; lang: Lang; clock: Clock }) {
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
        <b title={clock.local ? absTime(r.lastAt, lang) : undefined}>{relTime(r.lastAt, lang, clock.now)}</b>
        {" · "}
        {r.lastBy === "them" ? ui.crm.them : ui.crm.us}
      </span>
      {win}
    </span>
  );
}

type Props = {
  row: LeadRowDTO;
  kb: boolean;
  checked: boolean;
  leaving: boolean;
  ui: UiCopy;
  lang: Lang;
  wonLabel: string;
  clock: Clock;
  onOpen: (id: string) => void;
  onCheck: (id: string, on: boolean) => void;
  onMenu: (kind: RowMenu, id: string, anchor: HTMLElement) => void;
  onToggleRead: (id: string, unread: boolean) => void;
};

export const LeadRow = memo(function LeadRow({ row: r, kb, checked, leaving, ui, lang, wonLabel, clock, onOpen, onCheck, onMenu, onToggleRead }: Props) {
  const cls = ["crm-row", r.unread && "unread", kb && "kb", checked && "checked", leaving && "leaving"]
    .filter(Boolean)
    .join(" ");
  const onRowClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, input, a, label")) return;
    onOpen(r.id);
  };
  const menu = (kind: RowMenu) => (e: MouseEvent<HTMLButtonElement>) => onMenu(kind, r.id, e.currentTarget);
  const readLabel = r.unread ? ui.inbox.markRead : ui.inbox.markUnread;

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
          <span className={`crm-av-ch ${avatarDotClass(r)}`} />
        </span>
        <span className="crm-who-t">
          <span className="crm-name">
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
      <span className="crm-stand" role="gridcell" title={r.nextStepText || r.stand}>
        {r.nextStepText ? (
          <span className="crm-stand-next">
            <Icon name="calPlus" small />
            <bdi>{r.nextStepText}</bdi>
          </span>
        ) : (
          <bdi>{r.stand}</bdi>
        )}
      </span>
      <span className="crm-col-fu" role="gridcell">
        <FollowUp r={r} ui={ui} lang={lang} clock={clock} />
      </span>
      <LastContact r={r} ui={ui} lang={lang} clock={clock} />
      <span className="crm-row-actions" role="gridcell">
        {/* Pointer devices: icon buttons with a styled tooltip (label · shortcut).
            Touch / narrow lists: only the "more" button shows; its menu carries text labels. */}
        <button
          type="button"
          className="crm-ibtn"
          aria-label={readLabel}
          data-tip={tip(readLabel, "u")}
          onClick={() => onToggleRead(r.id, !r.unread)}
        >
          <Icon name={r.unread ? "mailOpen" : "mail"} />
        </button>
        <button
          type="button"
          className="crm-ibtn"
          aria-label={ui.crm.openLead}
          data-tip={tip(ui.crm.openLead, "Enter")}
          onClick={() => onOpen(r.id)}
        >
          <Icon name="msg" />
        </button>
        <button
          type="button"
          className="crm-ibtn"
          aria-label={ui.crm.nextStep}
          data-tip={tip(ui.crm.nextStep, "n")}
          aria-haspopup="menu"
          onClick={menu("next")}
        >
          <Icon name="calPlus" />
        </button>
        <button
          type="button"
          className="crm-ibtn crm-row-more"
          aria-label={ui.crm.moreActions}
          aria-haspopup="menu"
          onClick={menu("actions")}
        >
          <Icon name="more" />
        </button>
      </span>
    </div>
  );
});
