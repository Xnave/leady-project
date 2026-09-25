"use client";

import { useEffect, useRef, useState } from "react";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import { FollowUpBar } from "./FollowUpBar";
import { initials } from "./format";
import { LeadChat } from "./LeadChat";
import { LeadDetails } from "./LeadDetails";
import { LeadNotes } from "./LeadNotes";
import { LeadTabs, type LeadTab } from "./LeadTabs";
import { LeadTimeline } from "./LeadTimeline";
import { NextStepEditor } from "./NextStepEditor";
import { StageStepper } from "./StageStepper";
import { useClock } from "./useClock";
import { useLeadView, type RowChange } from "./useLeadView";

type Props = {
  dto: LeadViewDTO;
  ui: UiCopy;
  lang: "he" | "en";
  variant: "peek" | "page";
  /** Row fields changed by an action here (optimistic first, then as the server has them). */
  onChanged?: (row: RowChange) => void;
  wonLabel: string;
  /** Controlled tab, so the peek keeps the tab while j/k moves between leads. */
  tab?: LeadTab;
  onTab?: (t: LeadTab) => void;
  /** Id for the name heading (the peek's `aria-labelledby`). */
  headingId?: string;
};

/**
 * One lead: header with the stage stepper, the follow-up bar (the view's only primary
 * action), next step, internal notes, and the Conversation / Activity / Details tabs.
 * `peek` stacks everything in one column; `page` puts next step, notes and details in
 * a side column.
 */
export function LeadView({ dto, ui, lang, variant, onChanged, wonLabel, tab: tabProp, onTab, headingId }: Props) {
  const lv = useLeadView({ dto, ui, lang, wonLabel, onChanged });
  const d = lv.d;
  const clock = useClock();
  const [ownTab, setOwnTab] = useState<LeadTab>("chat");
  const tab = tabProp ?? ownTab;
  const setTab = onTab ?? setOwnTab;
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusComposer, setFocusComposer] = useState(0);

  // "Send message" on a cold lead: open the chat and put the cursor in the composer.
  useEffect(() => {
    if (!focusComposer) return;
    const input = rootRef.current?.querySelector<HTMLInputElement>(".crm-lv-chat .composer input");
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: "nearest" });
  }, [focusComposer]);

  const head = (
    <header className="crm-lv-head">
      <div className="crm-lv-id">
        <span className="crm-av lg" aria-hidden="true">
          {initials(d.name)}
          <span className={`crm-av-ch ${d.channel === "whatsapp" ? "wa" : "ig"}`} />
        </span>
        <div className="crm-lv-who">
          <h2 id={headingId}>
            <bdi>{d.name}</bdi>
            {d.demo ? <span className="badge badge-demo">{ui.common.demo}</span> : null}
          </h2>
          <div className="crm-lv-meta">
            <span className="ltr-isolate">{d.handle}</span>
            {d.intent ? (
              <span>
                {ui.common.intent}: <bdi>{d.intent}</bdi>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <StageStepper dto={d} ui={ui} wonLabel={wonLabel} onPick={lv.setStage} />
    </header>
  );

  const fubar = (
    <FollowUpBar
      dto={d}
      ui={ui}
      lang={lang}
      clock={clock}
      onDone={() => void lv.markDone()}
      onSnooze={lv.snooze}
      onChat={() => {
        setTab("chat");
        setFocusComposer((n) => n + 1);
      }}
    />
  );

  const next = (
    <NextStepEditor
      text={d.nextStepText}
      at={d.nextStepAt}
      ui={ui}
      lang={lang}
      clock={clock}
      onSave={(t, at) => void lv.setNext(t, at)}
      onDone={() => void lv.markDone()}
    />
  );

  const notes = <LeadNotes notes={d.notes} ui={ui} lang={lang} clock={clock} onAdd={lv.addNote} onPin={lv.pinNote} />;

  const tabs = (
    <LeadTabs
      tab={tab}
      onTab={setTab}
      ui={ui}
      hide={variant === "page" ? ["details"] : undefined}
      panels={{
        chat: () => <LeadChat dto={d} ui={ui} lang={lang} onSent={() => void lv.reload()} />,
        activity: () => <LeadTimeline timeline={d.timeline} ui={ui} lang={lang} clock={clock} wonLabel={wonLabel} />,
        details: () => <LeadDetails dto={d} ui={ui} />,
      }}
    />
  );

  if (variant === "page") {
    return (
      <div ref={rootRef} className="crm-full">
        <div className="crm-full-main">
          {head}
          {fubar}
          {tabs}
        </div>
        <aside className="crm-full-side">
          {next}
          {notes}
          <LeadDetails dto={d} ui={ui} />
        </aside>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="crm-lv">
      {head}
      {fubar}
      {next}
      {notes}
      <div className="crm-lv-tabwrap">{tabs}</div>
    </div>
  );
}
