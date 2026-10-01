"use client";

import { useCallback, useRef, useState } from "react";
import type { LeadRowDTO } from "@/lib/crm/view";

/**
 * Which lead the peek panel shows, and the list cursor that follows it. Opening marks
 * the lead read; closing puts the cursor and focus back on its row (or, if the row has
 * left the view, on the row now under the cursor).
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
  const peekIndex = peekId ? rows.findIndex((r) => r.id === peekId) : -1;
  const cursor = peekIndex >= 0 ? peekIndex : Math.min(kb, Math.max(0, rows.length - 1));

  const openLead = useCallback(
    (id: string) => {
      // The cursor moves to the opened row, so it stays put if that row later leaves the view.
      const i = rowsRef.current.findIndex((r) => r.id === id);
      if (i >= 0) setKb(i);
      setPeekId(id);
      markRead([id]);
    },
    [setKb, markRead],
  );

  const closePeek = useCallback(() => {
    const id = peekId;
    if (peekIndex >= 0) setKb(peekIndex);
    setPeekId(null);
    // After the close commits (a timer, not rAF, so it also runs in a background tab).
    setTimeout(() => {
      const el =
        (id && document.querySelector<HTMLElement>(`[data-row="${id}"]`)) ||
        document.querySelector<HTMLElement>(".crm-row.kb");
      el?.focus({ preventScroll: true });
    }, 0);
  }, [peekId, peekIndex, setKb]);

  /** The peeked row has left the view: the row now under the cursor is already the "next" one. */
  const gap = peekId !== null && peekIndex < 0;

  return { peekId, cursor, gap, openLead, closePeek };
}
