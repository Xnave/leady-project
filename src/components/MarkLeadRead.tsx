"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function MailIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {open ? (
        <>
          <path
            d="M4 8.5 12 14l8-5.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 8.5V18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 8.5 12 4l8 4.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <rect
            x="3"
            y="5"
            width="18"
            height="14"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M3 7l9 6 9-6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

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

  const label = unread ? markReadLabel : markUnreadLabel;

  return (
    <button
      type="button"
      className="btn-icon"
      disabled={pending}
      onClick={() => void toggle()}
      title={label}
      aria-label={label}
    >
      <MailIcon open={unread} />
    </button>
  );
}
