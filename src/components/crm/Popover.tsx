"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const EDGE = 8;
const ITEMS = '[role^="menuitem"]:not([disabled])';

/**
 * A small anchored menu, rendered in a portal so no transformed ancestor traps its
 * `position: fixed`. Mount it to open, unmount it to close. Closes on Esc (focus goes
 * back to `returnFocus`, default the anchor), on a pointer press outside, on scroll or
 * resize, and when focus leaves it. Arrow keys, Home and End move between items.
 */
export function Popover({
  anchor,
  returnFocus,
  label,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  returnFocus?: HTMLElement | null;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef(true);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  // Place it under the anchor, aligned to the anchor's inline-start edge; flip above when it won't fit.
  useLayoutEffect(() => {
    const pop = ref.current;
    if (!pop) return;
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const rtl = getComputedStyle(anchor).direction === "rtl";
    const x = Math.max(EDGE, Math.min(rtl ? r.right - pw : r.left, window.innerWidth - pw - EDGE));
    let y = r.bottom + GAP;
    const flip = y + ph > window.innerHeight - EDGE;
    if (flip) y = Math.max(EDGE, r.top - ph - GAP);
    pop.style.setProperty("--origin", flip ? "bottom" : "top");
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
  }); // every render: the content (and so the size) can change while open

  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>(`input, ${ITEMS}`)?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const target = returnFocus ?? anchor;
    const close = (restoreFocus: boolean) => {
      restore.current = restoreFocus;
      closeRef.current();
    };
    const inside = (n: EventTarget | null) => n instanceof Node && Boolean(ref.current?.contains(n));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    const onDown = (e: PointerEvent) => {
      if (inside(e.target) || anchor.contains(e.target as Node)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      if (restore.current && target.isConnected) target.focus({ preventScroll: true });
    };
  }, [anchor, returnFocus]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };

  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    // Focus going back to the anchor is our own restore (also StrictMode's effect replay), not a leave.
    if (to && !ref.current?.contains(to) && to !== anchor && to !== returnFocus) {
      restore.current = false;
      closeRef.current();
    }
  };

  return createPortal(
    <div ref={ref} className="crm-pop" role="menu" aria-label={label} onKeyDown={onKeyDown} onBlur={onBlur}>
      {children}
    </div>,
    document.body,
  );
}
