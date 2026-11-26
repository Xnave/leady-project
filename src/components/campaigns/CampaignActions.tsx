"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UiCopy } from "@/lib/ui";

type Copy = UiCopy["campaigns"]["run"];

export function CampaignActions({ id, status, copy }: { id: string; status: string; copy: Copy }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "pause" | "resume" | "cancel") {
    if (action === "cancel" && !window.confirm(copy.actions.cancelConfirm)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/runs/${encodeURIComponent(id)}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(copy.errors[(out.error ?? "failed") as keyof Copy["errors"]] ?? copy.errors.failed);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const canPause = status === "scheduled" || status === "sending";
  const canResume = status === "paused";
  const canCancel = ["draft", "scheduled", "sending", "paused"].includes(status);
  return (
    <div className="field-form-actions campaign-actions">
      {canPause ? (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void act("pause")}>
          {copy.actions.pause}
        </button>
      ) : null}
      {canResume ? (
        <button type="button" className="btn" disabled={busy} onClick={() => void act("resume")}>
          {copy.actions.resume}
        </button>
      ) : null}
      {canCancel ? (
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void act("cancel")}>
          {copy.actions.cancel}
        </button>
      ) : null}
      {error ? <p className="campaign-error">{error}</p> : null}
    </div>
  );
}
