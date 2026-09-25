"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** How long a toast (and its Undo) stays up. A deferred action commits when it runs out. */
export const TOAST_MS = 4500;
const EXIT_MS = 200;

export type ToastInput = {
  msg: string;
  /** Shows an Undo button. Runs instead of `onExpire`. */
  undo?: () => void;
  /** Runs when the toast times out without Undo, or when the page goes away first. */
  onExpire?: () => void;
};

type Pending = { undo?: () => void; onExpire?: () => void; timer: ReturnType<typeof setTimeout> };
type Shown = { id: number; msg: string; hasUndo: boolean; out: boolean };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

export function useToasts(): (t: ToastInput) => void {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToasts must be used inside <ToastProvider>");
  return push;
}

export function ToastProvider({ undoLabel, children }: { undoLabel: string; children: ReactNode }) {
  const [shown, setShown] = useState<Shown[]>([]);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setShown((cur) => cur.map((t) => (t.id === id ? { ...t, out: true } : t)));
    setTimeout(() => setShown((cur) => cur.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const expire = useCallback(
    (id: number) => {
      const p = pending.current.get(id);
      pending.current.delete(id);
      p?.onExpire?.();
      remove(id);
    },
    [remove],
  );

  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      pending.current.set(id, { undo: t.undo, onExpire: t.onExpire, timer: setTimeout(() => expire(id), TOAST_MS) });
      setShown((cur) => [...cur, { id, msg: t.msg, hasUndo: Boolean(t.undo), out: false }]);
    },
    [expire],
  );

  const undo = (id: number) => {
    const p = pending.current.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(id);
    p.undo?.();
    remove(id);
  };

  // Deferred actions (snooze) must not be lost when the owner navigates away inside the undo window.
  useEffect(() => {
    const map = pending.current;
    const flush = () => {
      for (const [id, p] of map) {
        clearTimeout(p.timer);
        map.delete(id);
        p.onExpire?.();
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="crm-toasts" role="status" aria-live="polite">
        {shown.map((t) => (
          <div key={t.id} className={t.out ? "crm-toast out" : "crm-toast"}>
            <span>{t.msg}</span>
            {t.hasUndo ? (
              <button type="button" onClick={() => undo(t.id)} disabled={t.out}>
                {undoLabel}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
