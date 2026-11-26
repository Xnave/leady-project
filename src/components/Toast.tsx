"use client";

import { useEffect, useRef, useState } from "react";

/** A short confirmation that sits above the page and then leaves. */
export function Toast({ text, tone = "ok", onDone }: { text: string; tone?: "ok" | "bad"; onDone?: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const hide = window.setTimeout(() => setLeaving(true), 2400);
    const finish = window.setTimeout(() => done.current?.(), 2700);
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(finish);
    };
  }, [text]);

  return (
    <div className={`app-toast${tone === "bad" ? " bad" : ""}${leaving ? " out" : ""}`} role="status">
      {text}
    </div>
  );
}
