"use client";

import { useState } from "react";

export function ConnectWhatsAppButton({
  label,
  disabled,
}: {
  label: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onClick() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/channels/zernio/connect", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not start connect");
        return;
      }
      window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button type="button" onClick={() => void onClick()} disabled={disabled || busy}>
        {busy ? "…" : label}
      </button>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
