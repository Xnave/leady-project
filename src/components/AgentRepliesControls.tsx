"use client";

import { useState } from "react";

type Labels = {
  agentRepliesTitle: string;
  agentRepliesHint: string;
  agentRepliesOn: string;
  agentRepliesOff: string;
  channelAgentReplies: string;
  saveFailed: string;
};

export function TenantAgentRepliesToggle({
  initialEnabled,
  labels,
}: {
  initialEnabled: boolean;
  labels: Labels;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/channels/agent-replies", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantAgentRepliesEnabled: next }),
      });
      if (!res.ok) {
        setEnabled(!next);
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? labels.saveFailed);
      }
    } catch {
      setEnabled(!next);
      setError(labels.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>{labels.agentRepliesTitle}</h2>
      <p className="muted">{labels.agentRepliesHint}</p>
      <label className="choice">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={() => void toggle()}
        />
        {enabled ? labels.agentRepliesOn : labels.agentRepliesOff}
      </label>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}

export function ChannelAgentRepliesToggle({
  channelId,
  initialEnabled,
  labels,
}: {
  channelId: string;
  initialEnabled: boolean;
  labels: Pick<
    Labels,
    "channelAgentReplies" | "agentRepliesOn" | "agentRepliesOff" | "saveFailed"
  >;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/channels/agent-replies", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, agentRepliesEnabled: next }),
      });
      if (!res.ok) {
        setEnabled(!next);
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? labels.saveFailed);
      }
    } catch {
      setEnabled(!next);
      setError(labels.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="choice" title={labels.channelAgentReplies}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={() => void toggle()}
        />
        {enabled ? labels.agentRepliesOn : labels.agentRepliesOff}
      </label>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
