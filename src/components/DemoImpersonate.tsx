"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { demoPhoneSender, phoneFromDemoSender } from "@/lib/demo-phone";
import { formatPhoneDisplay } from "@/lib/leads";

const STORAGE_KEY = "zapidly.demo-impersonations";
const RECENT_LIMIT = 8;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

type Labels = {
  impersonate: string;
  impersonatePhone: string;
  impersonateHint: string;
  impersonateRecent: string;
  impersonateInvalid: string;
  close: string;
  sending: string;
};

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const phones: string[] = [];
    for (const item of parsed) {
      const digits = phoneFromDemoSender(demoPhoneSender(typeof item === "string" ? item : ""));
      if (!digits || seen.has(digits)) continue;
      seen.add(digits);
      phones.push(digits);
      if (phones.length >= RECENT_LIMIT) break;
    }
    return phones;
  } catch {
    return [];
  }
}

function remember(raw: string): string[] {
  const digits = phoneFromDemoSender(demoPhoneSender(raw));
  if (!digits) return readRecent();
  const next = [digits, ...readRecent().filter((item) => item !== digits)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The thread still opens. The list is only a convenience in this browser.
  }
  return next;
}

/** Start a demo thread as a WhatsApp number. Recent numbers stay in this browser. */
export function DemoImpersonate({ labels }: { labels: Labels }) {
  const router = useRouter();
  const titleId = useId();
  const recentId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [phone, setPhone] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    phoneRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || pending) return;
      event.preventDefault();
      setOpen(false);
      openerRef.current?.focus();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, pending]);

  function close() {
    if (pending) return;
    setOpen(false);
    openerRef.current?.focus();
  }

  function trapTab(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.tabIndex !== -1 && el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function start(raw: string) {
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/demo/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ impersonatePhone: raw }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; leadId?: string };
      if (!res.ok || !data.leadId) {
        setError(data.error || labels.impersonateInvalid);
        return;
      }
      setRecent(remember(raw));
      setOpen(false);
      setPhone("");
      router.push(`/demo?leadId=${data.leadId}`);
    } catch {
      setError(labels.impersonateInvalid);
    } finally {
      setPending(false);
    }
  }

  const dialog = open ? (
    <div
      ref={dialogRef}
      className="demo-impersonate-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={trapTab}
    >
      <button type="button" className="demo-impersonate-scrim" tabIndex={-1} aria-label={labels.close} onClick={close} />
      <div className="demo-impersonate-card">
        <header>
          <h2 id={titleId}>{labels.impersonate}</h2>
          <button type="button" className="btn-ghost" onClick={close} disabled={pending}>
            {labels.close}
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void start(phone);
          }}
          className="stack"
        >
          <label>
            {labels.impersonatePhone}
            <input
              ref={phoneRef}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="off"
              required
              disabled={pending}
            />
          </label>
          <p className="muted">{labels.impersonateHint}</p>
          {error ? <p className="crm-task-error" role="alert">{error}</p> : null}
          <button type="submit" className="btn" disabled={pending} aria-busy={pending}>
            {pending ? labels.sending : labels.impersonate}
          </button>
        </form>
        {recent.length ? (
          <div>
            <p className="muted" id={recentId}>{labels.impersonateRecent}</p>
            <ul className="demo-impersonate-recent" aria-labelledby={recentId}>
              {recent.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pending}
                    onClick={() => void start(item)}
                  >
                    <bdi>{formatPhoneDisplay(item)}</bdi>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="btn-secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {labels.impersonate}
      </button>
      {mounted && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
