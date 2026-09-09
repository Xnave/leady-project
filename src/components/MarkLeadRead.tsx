"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkLeadRead({
  leadId,
  unread,
  markReadLabel,
  markUnreadLabel,
}: {
  leadId: string;
  unread: boolean;
  markReadLabel: string;
  markUnreadLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    try {
      await fetch(`/api/leads/${leadId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unread: !unread }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" className="btn-ghost" disabled={pending} onClick={() => void toggle()}>
      {unread ? markReadLabel : markUnreadLabel}
    </button>
  );
}
