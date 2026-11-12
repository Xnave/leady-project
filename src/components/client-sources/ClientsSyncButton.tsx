"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ClientsSyncButton({ labels }: { labels: { syncNow: string; syncing: string; syncQueued: string; syncDone: string; syncFailed: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function sync() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/clients/sync", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { queued?: boolean };
      setNote(!res.ok ? labels.syncFailed : data.queued ? labels.syncQueued : labels.syncDone);
      router.refresh();
    } catch {
      setNote(labels.syncFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="clients-meta">
      <button type="button" className="btn-secondary" disabled={busy} aria-busy={busy} onClick={() => void sync()}>
        {busy ? labels.syncing : labels.syncNow}
      </button>
      {note ? <span className="muted">{note}</span> : null}
    </span>
  );
}
