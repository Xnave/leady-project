"use client";

import { useState } from "react";

export function ConnectWhatsAppButton({
  label,
  disabled,
  errorLabel,
}: {
  label: string;
  disabled?: boolean;
  errorLabel: string;
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
        setError(data.error ?? errorLabel);
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
