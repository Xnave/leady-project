"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = { value: string; label: string; disabled?: boolean };

/**
 * Listbox that replaces the native <select>.
 *
 * A hidden input carries the value, so this drops into the plain HTML forms the
 * app POSTs without any extra wiring. Keyboard behaviour follows the APG
 * listbox pattern: Enter/Space/Arrow open, arrows and Home/End move, typing
 * jumps to a match, Escape closes and returns focus to the trigger.
 */
export function Select({
  name,
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  busy,
  invalid,
  className = "",
  placeholder,
}: {
  name?: string;
  value: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  invalid?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  // The list is portalled to <body> and positioned with fixed coordinates:
  // ancestors like .table-wrap set overflow, which would otherwise clip it.
  const [rect, setRect] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
    flip: boolean;
  } | null>(null);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const typeahead = useRef({ buffer: "", at: 0 });

  const selected = options.find((o) => o.value === value);
  const selectable = (i: number) => options[i] && !options[i].disabled;

  // Keep keyboard/hover highlight on the committed value so the first option
  // is not left looking selected after choosing another.
  useEffect(() => {
    const i = options.findIndex((o) => o.value === value);
    if (i >= 0) setActive(i);
  }, [value, options, open]);

  /**
   * Fixed-position the list so it is always fully on screen: pick whichever
   * side has more room, cap the height to the room actually available, and
   * clamp horizontally. Re-run on scroll, resize and after layout settles —
   * measuring only once left the list stranded when the page reflowed.
   */
  const place = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const gap = 4;
    const margin = 8;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - margin - gap;
    const above = r.top - margin - gap;
    // Prefer opening downward; flip only when the list would not fit below and
    // there is genuinely more room above.
    const desired = 264;
    const flip = below < desired && above > below;
    const room = Math.max(flip ? above : below, 0);
    setRect({
      top: flip ? undefined : r.bottom + gap,
      bottom: flip ? window.innerHeight - r.top + gap : undefined,
      left: Math.min(Math.max(margin, r.left), Math.max(margin, window.innerWidth - r.width - margin)),
      width: r.width,
      maxHeight: Math.max(120, Math.min(264, room)),
      flip,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // A second pass on the next frame catches layout that settles after paint.
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    }
    // `true` so the listener also fires for scrolls inside overflow containers.
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openAt(index: number) {
    setActive(index >= 0 ? index : 0);
    setOpen(true);
  }

  function commit(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange?.(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function step(from: number, delta: number) {
    let i = from;
    for (let guard = 0; guard < options.length; guard += 1) {
      i = (i + delta + options.length) % options.length;
      if (selectable(i)) return i;
    }
    return from;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const currentIndex = options.findIndex((o) => o.value === value);

    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openAt(currentIndex);
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        return;
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => step(i, 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => step(i, -1));
        return;
      case "Home":
        e.preventDefault();
        setActive(step(options.length - 1, 1));
        return;
      case "End":
        e.preventDefault();
        setActive(step(0, -1));
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        break;
    }

    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const state = typeahead.current;
      state.buffer = now - state.at > 700 ? e.key : state.buffer + e.key;
      state.at = now;
      const q = state.buffer.toLowerCase();
      const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(q));
      if (hit >= 0) setActive(hit);
    }
  }

  return (
    <div ref={rootRef} className={`select-root ${className}`.trim()}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={buttonRef}
        type="button"
        className={`select-trigger${invalid ? " has-error" : ""}`}
        disabled={disabled}
        aria-busy={busy}
        aria-invalid={invalid || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onClick={() => (open ? setOpen(false) : openAt(options.findIndex((o) => o.value === value)))}
      >
        <span className={`select-value${selected ? "" : " is-placeholder"}`}>
          {selected?.label ?? placeholder ?? ""}
        </span>
        <svg className="select-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && rect
        ? createPortal(
        <ul
          ref={listRef}
          id={listId}
          className={`select-list${rect.flip ? " is-flipped" : ""}`}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onKeyDown}
          style={{
            position: "fixed",
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxHeight,
          }}
        >
          {options.map((option, i) => {
            const isSelected = option.value === value;
            const isActive = open && i === active;
            return (
              <li
                key={option.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                data-active={isActive ? "true" : undefined}
                className={`select-option${isSelected ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => commit(i)}
              >
                <span>{option.label}</span>
                {isSelected ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </li>
            );
          })}
        </ul>,
        document.body,
      )
        : null}
    </div>
  );
}

/** Select bound to a plain form: keeps its own value, submits via the hidden input. */
export function FormSelect(props: Omit<Parameters<typeof Select>[0], "value" | "onChange"> & {
  defaultValue: string;
}) {
  const { defaultValue, ...rest } = props;
  const [value, setValue] = useState(defaultValue);
  return <Select {...rest} value={value} onChange={setValue} />;
}
