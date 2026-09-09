"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Soft-refresh the lead page so new channel messages appear without a hard reload.
 * Kept intentionally infrequent — full RSC refresh is expensive and floods the next log.
 */
export function LeadChatPoll({
  enabled = true,
  intervalMs = 4000,
}: {
  enabled?: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  const refreshing = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (refreshing.current) return;
      refreshing.current = true;
      router.refresh();
      // router.refresh is sync kickoff; cool down before allowing another.
      window.setTimeout(() => {
        refreshing.current = false;
      }, 2_000);
    };

    const id = window.setInterval(refresh, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs, router]);

  return null;
}
