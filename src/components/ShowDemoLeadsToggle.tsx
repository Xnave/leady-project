"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "leady.showDemoLeads";

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStored(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Checkbox that persists in localStorage and syncs the `demo` URL search param for the server list. */
export function ShowDemoLeadsToggle({ label }: { label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlOn = searchParams.get("demo") === "1";
  const queryKey = searchParams.toString();
  const [checked, setChecked] = useState(urlOn);
  const synced = useRef(false);

  useEffect(() => {
    const stored = readStored();
    setChecked(stored);
    if (synced.current && stored === urlOn) return;
    synced.current = true;
    if (stored === urlOn) return;
    const next = new URLSearchParams(queryKey);
    if (stored) next.set("demo", "1");
    else next.delete("demo");
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, queryKey, router, urlOn]);

  function onChange(next: boolean) {
    setChecked(next);
    writeStored(next);
    const params = new URLSearchParams(queryKey);
    if (next) params.set("demo", "1");
    else params.delete("demo");
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <label className="show-demo-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
