"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChatThread } from "@/components/ChatThread";

type Msg = {
  id: string;
  role: string;
  text: string;
  createdAt?: string | Date | null;
};

type ComposerLabels = {
  placeholder: string;
  waitingHuman: string;
  send: string;
  sending: string;
  sendFailed: string;
};

type ThreadLabels = {
  emptyThread: string;
  roles: Record<string, string>;
  today: string;
  yesterday: string;
};

/**
 * Demo simulator chat: optimistic outbound bubble + WhatsApp-style typing dots
 * until the server finishes the agent turn.
 */
export function DemoChat({
  leadId,
  from,
  disabled,
  lang,
  leadName,
  initialMessages,
  composerLabels,
  threadLabels,
}: {
  leadId?: string;
  from?: string;
  disabled?: boolean;
  lang: "he" | "en";
  leadName?: string;
  initialMessages: Msg[];
  composerLabels: ComposerLabels;
  threadLabels: ThreadLabels;
}) {
  const router = useRouter();
  const serverKey = useMemo(
    () => `${leadId ?? ""}:${initialMessages.map((m) => m.id).join(",")}`,
    [leadId, initialMessages],
  );
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMessages(initialMessages);
    setPending(false);
    setTyping(false);
  }, [serverKey, initialMessages]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending || disabled) return;

    const optimistic: Msg = {
      id: `local-${Date.now()}`,
      role: "lead",
      text: trimmed,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setText("");
    setPending(true);
    setTyping(true);
    setError(null);

    try {
      const res = await fetch("/api/demo/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, from: from || undefined, text: trimmed }),
      });
      const data = (await res.json()) as { error?: string; leadId?: string };
      if (!res.ok) throw new Error(data.error ?? composerLabels.sendFailed);
      if (data.leadId && data.leadId !== leadId) {
        router.push(`/demo?leadId=${data.leadId}`);
      } else {
        router.refresh();
      }
      // Keep typing/pending until serverKey updates with the agent reply.
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setText(trimmed);
      setError(err instanceof Error ? err.message : composerLabels.sendFailed);
      setTyping(false);
      setPending(false);
    }
  }

  return (
    <>
      <ChatThread
        lang={lang}
        messages={messages}
        labels={threadLabels}
        leadName={leadName}
        typing={typing}
      />
      <form onSubmit={onSubmit} className="composer">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? composerLabels.waitingHuman : composerLabels.placeholder}
          disabled={pending || disabled}
          aria-label={composerLabels.placeholder}
        />
        <button type="submit" disabled={pending || disabled}>
          {pending ? composerLabels.sending : composerLabels.send}
        </button>
        {error ? <p className="muted">{error}</p> : null}
      </form>
    </>
  );
}
