"use client";

import { useState } from "react";

export function ConnectChannelButton({
  provider,
  label,
  disabled,
  errorLabel,
}: {
  provider: "whatsapp" | "instagram";
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
      const res = await fetch("/api/channels/zernio/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
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
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void onClick()}
        disabled={disabled || busy}
      >
        {busy ? "…" : label}
      </button>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
