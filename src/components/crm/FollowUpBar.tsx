"use client";

import { useState } from "react";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import type { SnoozeDays } from "./crm-client";
import { relTime, untilTime, type Clock } from "./format";
import { Icon } from "./Icon";
import { FU_ICON } from "./LeadRow";
import { SnoozeMenu } from "./SnoozeMenu";

/**
 * Why the lead needs the owner now, and the view's single primary action (`.btn`):
 * handoff / approval → Inbox, reminder → mark done, cold → the chat composer, or the
 * phone when the WhatsApp window is closed. Cold and reminder also get Snooze.
 * Renders nothing when no follow-up is due, so the view then has no primary button.
 */
export function FollowUpBar({
  dto,
  ui,
  lang,
  clock,
  onDone,
  onSnooze,
  onChat,
}: {
  dto: LeadViewDTO;
  ui: UiCopy;
  lang: "he" | "en";
  clock: Clock | null;
  onDone: () => void;
  onSnooze: (days: SnoozeDays) => void;
  onChat: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const reason = dto.followUpReason;
  if (!dto.due || !reason) return null;

  const coldPhone = reason === "cold" && dto.windowClosed && Boolean(dto.waUrl);
  let sub = "";
  if (reason === "reminder") {
    const when = clock && dto.nextStepAt ? untilTime(dto.nextStepAt, lang, clock.now) : "";
    sub = [dto.nextStepText ? `"${dto.nextStepText}"` : "", when].filter(Boolean).join(" · ");
  } else if (clock && dto.followUpAt) {
    sub = relTime(dto.followUpAt, lang, clock.now);
  }
  if (reason === "cold" && dto.windowClosed) sub = [sub, ui.crm.windowClosed].filter(Boolean).join(" · ");

  let cta;
  if (reason === "handoff" || reason === "approval") {
    cta = (
      <a className="btn" href="/inbox">
        <Icon name="inbox" small />
        {ui.crm.cta[reason]}
      </a>
    );
  } else if (reason === "reminder") {
    cta = (
      <button type="button" className="btn" onClick={onDone}>
        <Icon name="check" small />
        {ui.crm.cta.reminder}
      </button>
    );
  } else if (coldPhone) {
    cta = (
      <a className="btn" href={dto.waUrl} target="_blank" rel="noopener noreferrer">
        <Icon name="phone" small />
        {ui.crm.cta.coldPhone}
      </a>
    );
  } else {
    cta = (
      <button type="button" className="btn" onClick={onChat}>
        <Icon name="msg" small />
        {ui.crm.cta.cold}
      </button>
    );
  }

  return (
    <div className={`crm-fubar crm-fu-${reason}`} role="region" aria-label={ui.crm.cols.followUp}>
      <div className="crm-fubar-text">
        <b>
          <Icon name={FU_ICON[reason]} small />
          {ui.crm.reasonsLong[reason]}
        </b>
        {sub ? <span>{sub}</span> : null}
      </div>
      {reason === "cold" || reason === "reminder" ? (
        <button
          type="button"
          className="btn-secondary"
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        >
          <Icon name="clock" small />
          {ui.crm.snooze}
        </button>
      ) : null}
      {cta}
      {anchor ? <SnoozeMenu anchor={anchor} ui={ui} onPick={onSnooze} onClose={() => setAnchor(null)} /> : null}
    </div>
  );
}
