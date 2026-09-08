"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UiCopy } from "@/lib/ui";

/**
 * Human takeover: mute the agent on this conversation and answer the customer
 * yourself. Distinct from the simulator composer, which fakes an inbound
 * message from the customer so the agent replies.
 */
export function TakeoverPanel({
  ui,
  leadId,
  paused,
  hasConversation,
}: {
  ui: UiCopy;
  leadId: string;
  paused: boolean;
  hasConversation: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"send" | "toggle" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleBot(next: boolean) {
    setBusy("toggle");
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/bot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
      if (!res.ok) throw new Error(ui.takeover.failed);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : ui.takeover.failed);
    } finally {
      setBusy(null);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy("send");
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!res.ok) throw new Error(ui.takeover.failed);
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : ui.takeover.failed);
    } finally {
      setBusy(null);
    }
  }

  if (!hasConversation) {
    return (
      <div className="card">
        <h3>{ui.takeover.legend}</h3>
        <p className="muted">{ui.takeover.noConversation}</p>
      </div>
    );
  }

  return (
    <div className="card takeover">
      <h3>{ui.takeover.legend}</h3>
      <div className="takeover-switch" role="group" aria-label={ui.takeover.legend}>
        <button
          type="button"
          className={paused ? "" : "active"}
          aria-pressed={!paused}
          disabled={busy !== null}
          onClick={() => (paused ? toggleBot(false) : undefined)}
        >
          {ui.takeover.botOn}
        </button>
        <button
          type="button"
          className={paused ? "active" : ""}
          aria-pressed={paused}
          disabled={busy !== null}
          onClick={() => (paused ? undefined : toggleBot(true))}
        >
          {ui.takeover.botOff}
        </button>
      </div>
      <p className="muted">{ui.takeover.replyHint}</p>
      <form onSubmit={send} className="stack">
        <textarea
          className="note-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={ui.takeover.replyPlaceholder}
          aria-label={ui.takeover.replyPlaceholder}
          rows={3}
        />
        <div className="row-actions">
          <button type="submit" disabled={busy !== null || !text.trim()}>
            {busy === "send" ? ui.common.sending : ui.common.send}
          </button>
        </div>
      </form>
      {error ? <p className="muted takeover-error">{error}</p> : null}
    </div>
  );
}
