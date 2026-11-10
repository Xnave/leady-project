"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChatThread } from "@/components/ChatThread";
import { shouldResetThread, threadKey } from "@/components/demo-chat-state";

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
  dropFile?: string;
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
  const serverKey = threadKey(leadId, initialMessages);
  const shownKey = useRef(serverKey);
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragDepth = useRef(0);
  // Until hydration the form would submit natively and drop the message.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!shouldResetThread(shownKey.current, serverKey)) return;
    shownKey.current = serverKey;
    setMessages(initialMessages);
    setPending(false);
    setTyping(false);
    // initialMessages is read only when its identity key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  async function sendMessage(rawText: string, sending: File | null) {
    const trimmed = rawText.trim();
    if ((!trimmed && !sending) || pending || disabled || !ready) return;

    const optimistic: Msg = {
      id: `local-${Date.now()}`,
      role: "lead",
      text: trimmed || sending?.name || "",
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setText("");
    setPending(true);
    setTyping(true);
    setError(null);

    try {
      let attached: { filename: string; mime: string; base64: string } | undefined;
      if (sending) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(sending);
        });
        attached = {
          filename: sending.name,
          mime: sending.type || "application/octet-stream",
          base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
        };
      }
      const res = await fetch("/api/demo/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, from: from || undefined, text: trimmed, file: attached }),
      });
      // A crashed route can answer with an empty or HTML body; don't let parsing mask the real error.
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        leadId?: string;
        messages?: Msg[];
      };
      if (!res.ok) throw new Error(data.error ?? composerLabels.sendFailed);
      if (data.messages?.length) {
        shownKey.current = threadKey(data.leadId ?? leadId, data.messages);
        setMessages(data.messages);
        setPending(false);
        setTyping(false);
      }
      if (data.leadId && data.leadId !== leadId) {
        router.push(`/demo?leadId=${data.leadId}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setText(trimmed);
      setError(err instanceof Error ? err.message : composerLabels.sendFailed);
      setTyping(false);
      setPending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sendMessage(text, null);
  }

  function hasFiles(e: React.DragEvent) {
    return [...e.dataTransfer.types].includes("Files");
  }

  function onDragEnter(e: React.DragEvent) {
    if (!hasFiles(e) || pending || disabled || !ready) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragOver(e: React.DragEvent) {
    if (!hasFiles(e) || pending || disabled || !ready) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(e: React.DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    void sendMessage(text, dropped);
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.files?.[0];
    if (!pasted) return;
    e.preventDefault();
    void sendMessage(text, pasted);
  }

  return (
    <div
      className={`demo-drop${dragging ? " is-dragging" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <ChatThread
        lang={lang}
        messages={messages}
        labels={threadLabels}
        leadName={leadName}
        typing={typing}
      />
      {dragging && composerLabels.dropFile ? (
        <div className="demo-drop-overlay" role="status">
          {composerLabels.dropFile}
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="composer">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          placeholder={disabled ? composerLabels.waitingHuman : composerLabels.placeholder}
          disabled={pending || disabled || !ready}
          aria-label={composerLabels.placeholder}
        />
        <button type="submit" disabled={pending || disabled || !ready || !text.trim()}>
          {pending ? composerLabels.sending : composerLabels.send}
        </button>
        {error ? <p className="muted">{error}</p> : null}
      </form>
    </div>
  );
}
