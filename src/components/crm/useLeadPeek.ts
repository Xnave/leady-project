"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeadRowDTO } from "@/lib/crm/view";

/** Where `.crm-peek` (`min(560px, 100%)` wide) covers the whole screen. */
const FULLSCREEN_PEEK = "(max-width: 560px)";

/**
 * Which lead the peek panel shows, and the list cursor that follows it. Opening marks
 * the lead read; closing puts the cursor and focus back on its row (or, if the row has
 * left the view, on the row now under the cursor). Where the peek is full screen it
 * also owns a history entry, so the phone's Back gesture closes it instead of leaving
 * the page.
 */
export function useLeadPeek(o: {
  rows: LeadRowDTO[];
  kb: number;
  setKb: (i: number) => void;
  markRead: (ids: string[]) => void;
}) {
  const { rows, kb, setKb, markRead } = o;
  const [peekId, setPeekId] = useState<string | null>(null);
  // Read at call time, so `openLead` keeps one identity and the memoised rows don't re-render.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const peekIdRef = useRef(peekId);
  peekIdRef.current = peekId;
  const historyEntry = useRef(false);
  const peekIndex = peekId ? rows.findIndex((r) => r.id === peekId) : -1;
  const cursor = peekIndex >= 0 ? peekIndex : Math.min(kb, Math.max(0, rows.length - 1));

  const openLead = useCallback(
    (id: string) => {
      // The cursor moves to the opened row, so it stays put if that row later leaves the view.
      const i = rowsRef.current.findIndex((r) => r.id === id);
      if (i >= 0) setKb(i);
      if (peekIdRef.current === null && !historyEntry.current && window.matchMedia(FULLSCREEN_PEEK).matches) {
        // Same URL: Next keeps its router state on the entry and just records it.
        window.history.pushState({ crmPeek: true }, "");
        historyEntry.current = true;
      }
      setPeekId(id);
      // Only POST when the row is still unread (setUnread also no-ops, but skip the call for j/k).
      const row = i >= 0 ? rowsRef.current[i] : null;
      if (row?.unread) markRead([id]);
    },
    [setKb, markRead],
  );

  const closePeek = useCallback(() => {
    const id = peekId;
    if (peekIndex >= 0) setKb(peekIndex);
    setPeekId(null);
    if (historyEntry.current) {
      historyEntry.current = false;
      window.history.back();
    }
    // After the close commits (a timer, not rAF, so it also runs in a background tab).
    setTimeout(() => {
      const el =
        (id && document.querySelector<HTMLElement>(`[data-row="${id}"]`)) ||
        document.querySelector<HTMLElement>(".crm-row.kb");
      el?.focus({ preventScroll: true });
    }, 0);
  }, [peekId, peekIndex, setKb]);

  // Back while the full-screen peek is open pops its entry: close it.
  const closeRef = useRef(closePeek);
  closeRef.current = closePeek;
  useEffect(() => {
    const onPop = () => {
      if (!historyEntry.current) return;
      historyEntry.current = false;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** The peeked row has left the view: the row now under the cursor is already the "next" one. */
  const gap = peekId !== null && peekIndex < 0;

  return { peekId, cursor, gap, openLead, closePeek };
}
