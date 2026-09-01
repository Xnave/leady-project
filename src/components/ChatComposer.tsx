"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ChatComposer({
  leadId,
  from,
  disabled,
}: {
  leadId?: string;
  from?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, from: from || undefined, text: text.trim() }),
      });
      const data = (await res.json()) as { error?: string; leadId?: string };
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setText("");
      if (data.leadId && data.leadId !== leadId) {
        router.push(`/demo?leadId=${data.leadId}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="composer">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? "Waiting on a human…" : "Message as this customer"}
        disabled={pending || disabled}
      />
      <button type="submit" disabled={pending || disabled}>
        {pending ? "…" : "Send"}
      </button>
      {error ? <p className="muted">{error}</p> : null}
    </form>
  );
}
