"use client";

import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import { relTime, untilTime, type Clock } from "./format";
import { Icon } from "./Icon";
import { FU_ICON } from "./LeadRow";

/**
 * Why the lead needs the owner now, and the view's single primary action (`.btn`):
 * reminder → mark done, cold → the chat composer, or the
 * phone when the WhatsApp window is closed.
 * Renders nothing when no follow-up is due, so the view then has no primary button.
 */
export function FollowUpBar({
  dto,
  ui,
  lang,
  clock,
  onDone,
  onChat,
}: {
  dto: LeadViewDTO;
  ui: UiCopy;
  lang: "he" | "en";
  clock: Clock | null;
  onDone: () => void;
  onChat: () => void;
}) {
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

  // Handoff and approval are acted on in the task card above (see TaskCard).
  if (reason === "handoff" || reason === "approval") return null;

  let cta;
  if (reason === "reminder") {
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
      {cta}
    </div>
  );
}
