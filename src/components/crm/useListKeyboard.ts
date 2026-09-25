"use client";

import { useEffect, useRef } from "react";
import type { RowMenu } from "./LeadRow";

const TYPING = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]';

export type ListKeyHandlers = {
  /** Number of rows; the cursor stays inside [0, count). */
  count: number;
  kb: number;
  /** A popover handles its own keys while open. */
  menuOpen: boolean;
  moveTo: (index: number) => void;
  open: (index: number) => void;
  menu: (kind: RowMenu, index: number) => void;
  canSnooze: (index: number) => boolean;
  escape: () => void;
  focusSearch: () => void;
};

/**
 * The list's shortcuts (from the mockup): j/k and arrows move, Enter opens, s stage,
 * n next step, z snooze, / search, Esc clears. Ignored while typing or with a modifier.
 */
export function useListKeyboard(h: ListKeyHandlers) {
  const ref = useRef(h);
  useEffect(() => {
    ref.current = h;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = ref.current;
      if (c.menuOpen || e.defaultPrevented) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = Boolean(t?.matches(TYPING));
      if (e.key === "Escape") {
        if (typing) t?.blur();
        else c.escape();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const has = c.count > 0;
      switch (e.key) {
        case "/":
          e.preventDefault();
          c.focusSearch();
          return;
        case "j":
        case "ArrowDown":
          if (!has) return;
          e.preventDefault();
          c.moveTo(Math.min(c.count - 1, c.kb + 1));
          return;
        case "k":
        case "ArrowUp":
          if (!has) return;
          e.preventDefault();
          c.moveTo(Math.max(0, c.kb - 1));
          return;
        case "Enter":
          // A focused button or link keeps its own Enter.
          if (!has || (t && t !== document.body && t.getAttribute("role") !== "row")) return;
          e.preventDefault();
          c.open(c.kb);
          return;
        case "s":
        case "n":
          if (!has) return;
          e.preventDefault();
          c.menu(e.key === "s" ? "stage" : "next", c.kb);
          return;
        case "z":
          if (!has || !c.canSnooze(c.kb)) return;
          e.preventDefault();
          c.menu("snooze", c.kb);
          return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
