"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Soft-refresh the lead page so new channel messages appear without a hard reload. */
export function LeadChatPoll({ enabled = true, intervalMs = 4000 }: { enabled?: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, router]);
  return null;
}
