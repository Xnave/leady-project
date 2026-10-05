"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { LeadRowDTO, LeadViewDTO, LeadViewScope } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import { crmApi } from "./crm-client";
import { markCrmClient } from "./crm-perf";
import { Icon } from "./Icon";
import type { LeadTab } from "./LeadTabs";
import { LeadView } from "./LeadView";
import { shellFromRow } from "./peek-shell";
import type { PeekReport } from "./rows";

/** Matches the `.crm-peek` slide-out; content stays until the panel is out of view. */
const EXIT_MS = 260;
const TYPING = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

/**
 * The lead peek: a drawer over the list. Opens instantly from the list row (header /
 * stand), then loads lite view in the background. Activity/Details fetch full once.
 */
export function LeadPeek({
  leadId,
  peekRow,
  onClose,
  onChanged,
  ui,
  lang,
  wonLabel,
}: {
  leadId: string | null;
  /** List row for instant chrome; null when the peeked row left the current view. */
  peekRow: LeadRowDTO | null;
  onClose: () => void;
  onChanged: (report: PeekReport) => void;
  ui: UiCopy;
  lang: "he" | "en";
  wonLabel: string;
}) {
  const open = leadId !== null;
  const [dto, setDto] = useState<LeadViewDTO | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<LeadTab>("chat");
  const [viewScope, setViewScope] = useState<LeadViewScope>("lite");
  const panelRef = useRef<HTMLElement>(null);
  const openStarted = useRef(0);
  const fullInflight = useRef(false);
  // A new lead starts without the previous lead's error.
  const [seenId, setSeenId] = useState(leadId);
  if (seenId !== leadId) {
    setSeenId(leadId);
    setFailed(false);
    setViewScope("lite");
    fullInflight.current = false;
  }
  const headingId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!leadId) return;
    let live = true;
    openStarted.current = performance.now();
    setViewScope("lite");
    fullInflight.current = false;

    // Instant chrome from the list row (felt first paint).
    if (peekRow && peekRow.id === leadId) {
      setDto(shellFromRow(peekRow));
      setChatLoading(true);
      setFailed(false);
      markCrmClient("crm.client.peek_shell", {
        ms: performance.now() - openStarted.current,
        leadId,
        scope: "lite",
      });
    } else {
      setChatLoading(true);
    }

    crmApi.view(leadId, { scope: "lite" }).then(
      (v) => {
        if (!live) return;
        const ms = performance.now() - openStarted.current;
        markCrmClient("crm.client.peek_open", { ms, leadId, scope: "lite" });
        setFailed(false);
        setChatLoading(false);
        setDto(v);
        requestAnimationFrame(() => {
          if (!live) return;
          markCrmClient("crm.client.peek_paint", {
            ms: performance.now() - openStarted.current,
            leadId,
            scope: "lite",
          });
        });
      },
      () => {
        if (live) {
          setFailed(true);
          setChatLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
    // peekRow intentionally omitted: shell is applied when leadId changes; stale row is ok.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open clock is leadId/attempt
  }, [leadId, attempt]);

  const ensureFull = (nextTab: LeadTab) => {
    if (nextTab !== "activity" && nextTab !== "details") return;
    if (!leadId || viewScope === "full" || fullInflight.current || chatLoading) return;
    fullInflight.current = true;
    const t0 = performance.now();
    crmApi.view(leadId, { scope: "full" }).then(
      (v) => {
        markCrmClient("crm.client.peek_full", {
          ms: performance.now() - t0,
          leadId,
          scope: "full",
        });
        setDto(v);
        setViewScope("full");
        fullInflight.current = false;
      },
      () => {
        fullInflight.current = false;
      },
    );
  };

  const onTab = (t: LeadTab) => {
    setTab(t);
    ensureFull(t);
  };

  // After the slide-out, forget the lead so the next open starts clean.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setDto(null);
      setFailed(false);
      setTab("chat");
      setViewScope("lite");
      setChatLoading(false);
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
  // Stale previous-lead dim only when we have no shell for the new id yet.
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
        aria-busy={loading || chatLoading}
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
            <a className="crm-ibtn" href={`/leads/${leadId}`} aria-label={ui.crm.openFull} data-tip={ui.crm.openFull}>
              <Icon name="expand" />
            </a>
          ) : null}
          <button type="button" className="crm-ibtn" onClick={onClose} aria-label={ui.crm.close} data-tip={`${ui.crm.close} · Esc`}>
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
              onTab={onTab}
              headingId={headingId}
              viewScope={viewScope}
              chatLoading={chatLoading}
            />
          ) : (
            <div className="crm-lv" aria-hidden="true">
              <div className="crm-lv-head">
                <div className="crm-lv-id">
                  <span className="crm-skel av lg" />
                  <div className="crm-lv-who crm-skel-stack">
                    <span className="crm-skel w60" />
                    <span className="crm-skel w40" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
