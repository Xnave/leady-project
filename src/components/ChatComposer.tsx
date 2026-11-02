"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Labels = {
  placeholder: string;
  waitingHuman: string;
  send: string;
  sending: string;
  sendFailed: string;
  attach?: string;
};

/** Customer simulator - used on /demo only. */
export function ChatComposer({
  leadId,
  from,
  disabled,
  labels,
}: {
  leadId?: string;
  from?: string;
  disabled?: boolean;
  labels: Labels;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setPending(true);
    setError(null);
    try {
      let attached: { filename: string; mime: string; base64: string } | undefined;
      if (file) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        attached = {
          filename: file.name,
          mime: file.type || "application/octet-stream",
          base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
        };
      }
      const res = await fetch("/api/demo/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          from: from || undefined,
          text: text.trim(),
          file: attached,
        }),
      });
      const data = (await res.json()) as { error?: string; leadId?: string };
      if (!res.ok) throw new Error(data.error ?? labels.sendFailed);
      setText("");
      setFile(null);
      if (data.leadId && data.leadId !== leadId) {
        router.push(`/demo?leadId=${data.leadId}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.sendFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="composer">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? labels.waitingHuman : labels.placeholder}
        disabled={pending || disabled}
        aria-label={labels.placeholder}
        dir="auto"
        enterKeyHint="send"
        autoComplete="off"
      />
      {labels.attach ? (
        <label className="muted">
          {labels.attach}
          <input
            type="file"
            accept="image/*,.pdf,.docx"
            disabled={pending || disabled}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : null}
      <button type="submit" disabled={pending || disabled || (!text.trim() && !file)}>
        {pending ? labels.sending : labels.send}
      </button>
      {error ? <p className="muted">{error}</p> : null}
    </form>
  );
}

/** Staff reply composer for lead workspace - posts as human, not customer. */
export function StaffChatComposer({
  leadId,
  conversationId,
  disabled,
  labels,
  onSent,
}: {
  leadId: string;
  conversationId?: string;
  disabled?: boolean;
  labels: Labels;
  /** Runs after a successful send, e.g. to reload a client-fetched thread. */
  onSent?: () => void;
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
      const res = await fetch(`/api/leads/${leadId}/staff-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, text: text.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? labels.sendFailed);
      setText("");
      onSent?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.sendFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="composer">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? labels.waitingHuman : labels.placeholder}
        disabled={pending || disabled}
        aria-label={labels.placeholder}
        dir="auto"
        enterKeyHint="send"
        autoComplete="off"
      />
      <button type="submit" disabled={pending || disabled}>
        {pending ? labels.sending : labels.send}
      </button>
      {error ? <p className="muted">{error}</p> : null}
    </form>
  );
}
