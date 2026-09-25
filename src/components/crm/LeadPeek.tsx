"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import { crmApi } from "./crm-client";
import { Icon } from "./Icon";
import type { LeadTab } from "./LeadTabs";
import { LeadView } from "./LeadView";
import type { RowChange } from "./useLeadView";

/** Matches the `.crm-peek` slide-out; content stays until the panel is out of view. */
const EXIT_MS = 260;
const TYPING = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

function PeekSkeleton() {
  return (
    <div className="crm-lv" aria-hidden="true">
      <div className="crm-lv-head">
        <div className="crm-lv-id">
          <span className="crm-skel av lg" />
          <div className="crm-lv-who crm-skel-stack">
            <span className="crm-skel w60" />
            <span className="crm-skel w40" />
          </div>
        </div>
        <span className="crm-skel w80" />
        <span className="crm-skel chip" />
      </div>
      <div className="crm-sec crm-skel-stack">
        <span className="crm-skel w40" />
        <span className="crm-skel w80" />
      </div>
      <div className="crm-sec crm-skel-stack">
        <span className="crm-skel w40" />
        <span className="crm-skel w60" />
      </div>
    </div>
  );
}

/**
 * The lead peek: a drawer over the list. It loads `crmApi.view` whenever `leadId`
 * changes, keeping the previous lead on screen (dimmed) while the next one loads, and
 * a skeleton on first open. Esc, the scrim and the close button close it; focus moves
 * into the panel on open (the list puts it back on the row on close).
 */
export function LeadPeek({
  leadId,
  onClose,
  onChanged,
  ui,
  lang,
  wonLabel,
}: {
  leadId: string | null;
  onClose: () => void;
  onChanged: (row: RowChange) => void;
  ui: UiCopy;
  lang: "he" | "en";
  wonLabel: string;
}) {
  const open = leadId !== null;
  const [dto, setDto] = useState<LeadViewDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<LeadTab>("chat");
  const panelRef = useRef<HTMLElement>(null);
  // A new lead starts without the previous lead's error.
  const [seenId, setSeenId] = useState(leadId);
  if (seenId !== leadId) {
    setSeenId(leadId);
    setFailed(false);
  }
  const headingId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!leadId) return;
    let live = true;
    crmApi.view(leadId).then(
      (v) => {
        if (!live) return;
        setFailed(false);
        setDto(v);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [leadId, attempt]);

  // After the slide-out, forget the lead so the next open starts from the skeleton.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setDto(null);
      setFailed(false);
      setTab("chat");
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Esc closes, unless a popover is open (it closes itself) or the owner is typing (the input blurs).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".crm-pop")) return;
      if (e.target instanceof HTMLElement && e.target.matches(TYPING)) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  // Keep Tab inside the panel while it is open (it is modal over the list).
  const trapTab = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const current = dto && dto.id === leadId;
  const loading = open && !current && !failed;

  return (
    <>
      <div className={open ? "crm-scrim on" : "crm-scrim"} onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className={open ? "crm-peek on" : "crm-peek"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dto ? headingId : undefined}
        aria-label={dto ? undefined : ui.page.leadsTitle}
        aria-busy={loading}
        tabIndex={-1}
        inert={!open}
        onKeyDown={trapTab}
      >
        <div className="crm-peek-top">
          <span className="crm-peek-title">
            {ui.page.leadsTitle}
            {dto ? (
              <>
                {" / "}
                <bdi>{dto.name}</bdi>
              </>
            ) : null}
          </span>
          {leadId ? (
            <a className="crm-ibtn" href={`/leads/${leadId}`} aria-label={ui.crm.openFull} title={ui.crm.openFull}>
              <Icon name="expand" />
            </a>
          ) : null}
          <button type="button" className="crm-ibtn" onClick={onClose} aria-label={ui.crm.close} title={`${ui.crm.close} (Esc)`}>
            <Icon name="x" />
          </button>
        </div>
        <div className={loading && dto ? "crm-peek-body stale" : "crm-peek-body"}>
          {failed && !current ? (
            <div className="crm-empty" role="alert">
              <strong>{ui.crm.loadFailed}</strong>
              <button type="button" className="btn-secondary" onClick={() => {
                  setFailed(false);
                  setAttempt((n) => n + 1);
                }}>
                {ui.crm.retry}
              </button>
            </div>
          ) : dto ? (
            <LeadView
              key={dto.id}
              dto={dto}
              ui={ui}
              lang={lang}
              variant="peek"
              wonLabel={wonLabel}
              onChanged={onChanged}
              tab={tab}
              onTab={setTab}
              headingId={headingId}
            />
          ) : (
            <PeekSkeleton />
          )}
        </div>
      </aside>
    </>
  );
}
