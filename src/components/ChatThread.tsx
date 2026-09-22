"use client";

import { Fragment, useLayoutEffect, useRef } from "react";
import { parseMessageTextParts } from "@/lib/message-links";

type Msg = {
  id: string;
  role: string;
  text: string;
  createdAt?: string | Date | null;
};

type Labels = {
  emptyThread: string;
  roles: Record<string, string>;
  today?: string;
  yesterday?: string;
};

function renderMessageText(text: string) {
  return parseMessageTextParts(text).map((part, i) =>
    part.kind === "url" ? (
      <a
        key={`a-${i}`}
        className="bubble-link"
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        dir="ltr"
      >
        {part.href}
      </a>
    ) : (
      <Fragment key={`t-${i}`}>{part.value}</Fragment>
    ),
  );
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayStamp(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatMessageTime(d: Date, lang: "he" | "en"): string {
  return d.toLocaleTimeString(lang === "he" ? "he-IL" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDayLabel(
  d: Date,
  lang: "he" | "en",
  labels: { today?: string; yesterday?: string },
  now = new Date(),
): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return labels.today ?? (lang === "he" ? "היום" : "Today");
  if (diffDays === 1) return labels.yesterday ?? (lang === "he" ? "אתמול" : "Yesterday");
  return d.toLocaleDateString(lang === "he" ? "he-IL" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: day.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

type ThreadItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; message: Msg; at: Date | null };

function buildThreadItems(
  messages: Msg[],
  lang: "he" | "en",
  labels: Labels,
): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastDay = "";
  for (const message of messages) {
    const at = toDate(message.createdAt ?? null);
    if (at) {
      const stamp = dayStamp(at);
      if (stamp !== lastDay) {
        lastDay = stamp;
        items.push({
          kind: "day",
          key: `day-${stamp}`,
          label: formatDayLabel(at, lang, labels),
        });
      }
    }
    items.push({ kind: "msg", key: message.id, message, at });
  }
  return items;
}

export function ChatThread({
  messages,
  labels,
  lang = "en",
  leadName,
  typing = false,
}: {
  messages: Msg[];
  labels: Labels;
  lang?: "he" | "en";
  /** When set, customer bubbles show this instead of the generic "lead" role label. */
  leadName?: string;
  /** WhatsApp-style “agent is typing” indicator. */
  typing?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id ?? "";

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastId, messages.length, typing]);

  function roleName(role: string) {
    if (role === "lead" && leadName?.trim()) return leadName.trim();
    return labels.roles[role] ?? role;
  }

  const items = buildThreadItems(messages, lang, labels);

  return (
    <div className="thread" ref={rootRef}>
      {messages.length === 0 && !typing ? <p className="muted">{labels.emptyThread}</p> : null}
      {items.map((item) =>
        item.kind === "day" ? (
          <div key={item.key} className="thread-day">
            <span>{item.label}</span>
          </div>
        ) : (
          <div key={item.key} className={`bubble ${item.message.role}`}>
            <div className="bubble-role">{roleName(item.message.role)}</div>
            <div className="bubble-text">{renderMessageText(item.message.text)}</div>
            {item.at ? (
              <div className="bubble-time">{formatMessageTime(item.at, lang)}</div>
            ) : null}
          </div>
        ),
      )}
      {typing ? (
        <div className="bubble agent typing" aria-live="polite" aria-label="…">
          <div className="bubble-role">{roleName("agent")}</div>
          <div className="typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      ) : null}
    </div>
  );
}
