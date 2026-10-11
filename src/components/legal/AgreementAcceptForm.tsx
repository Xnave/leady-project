"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Copy = {
  checkbox: string;
  submit: string;
  error: string;
  scrollHint: string;
  expand: string;
  collapse: string;
  docLabel: string;
};

/** Pixels from the bottom that still count as "read to the end". */
const END_SLACK = 24;

/**
 * The agreement box plus the approval form. Approval unlocks only after the owner scrolled
 * the whole document, in the box or in the enlarged view (same element, so progress carries over).
 */
export function AgreementAcceptForm({
  children,
  version,
  copy,
  showError,
}: {
  children: ReactNode;
  version: string;
  copy: Copy;
  showError: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [readToEnd, setReadToEnd] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const check = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - END_SLACK) setReadToEnd(true);
  }, []);

  // A box tall enough to show everything counts as read.
  useEffect(() => {
    check();
  }, [check, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    boxRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  return (
    <>
      <div className="accept-doc-tools">
        <button type="button" className="btn-ghost" onClick={() => setExpanded(true)}>
          {copy.expand}
        </button>
      </div>
      <div
        ref={boxRef}
        className={`accept-doc${expanded ? " expanded" : ""}`}
        tabIndex={0}
        aria-label={copy.docLabel}
        {...(expanded ? { role: "dialog", "aria-modal": true } : {})}
        onScroll={check}
      >
        {expanded ? (
          <div className="accept-doc-bar">
            <button type="button" className="btn-secondary" onClick={() => setExpanded(false)}>
              {copy.collapse}
            </button>
          </div>
        ) : null}
        {children}
      </div>

      <form action="/api/legal/accept" method="post" className="stack">
        <input type="hidden" name="version" value={version} />
        {!readToEnd ? (
          <p className="accept-hint" aria-live="polite">
            {copy.scrollHint}
          </p>
        ) : null}
        <label className={`accept-check${readToEnd ? "" : " disabled"}`}>
          <input type="checkbox" name="agree" required disabled={!readToEnd} />
          <span>{copy.checkbox}</span>
        </label>
        {showError ? (
          <p role="alert" className="accept-error">
            {copy.error}
          </p>
        ) : null}
        <button type="submit" disabled={!readToEnd}>
          {copy.submit}
        </button>
      </form>
    </>
  );
}
