"use client";

import { useEffect, useState } from "react";
import type { Clock } from "./format";

/**
 * The browser clock, or null before mount. Anything timezone- or now-dependent in the
 * lead view renders only once this is set, so server HTML and hydration always match.
 * Ticks once a minute.
 */
export function useClock(): Clock | null {
  const [clock, setClock] = useState<Clock | null>(null);
  useEffect(() => {
    const tick = () => setClock({ now: new Date(), local: true });
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);
  return clock;
}
