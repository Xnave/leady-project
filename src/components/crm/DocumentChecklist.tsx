"use client";

import { useState } from "react";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";

export function DocumentChecklist({
  leadId,
  checklist,
  ui,
}: {
  leadId: string;
  checklist: LeadViewDTO["documents"];
  ui: UiCopy;
}) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!checklist || checklist.slots.length === 0) return null;
  const copy = ui.documentsUi;
  async function release() {
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/leads/${leadId}/documents/next-stage`, { method: "POST" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="crm-sec" aria-label={copy.title}>
      <div className="crm-sec-h">{copy.title}</div>
      {checklist.nextStageId && !sent ? (
        <button type="button" className="crm-btn-quiet" disabled={pending} onClick={() => void release()}>
          {copy.releaseNext}
        </button>
      ) : null}
      {sent ? <p className="muted">{copy.nextStageReleased}</p> : null}
      {failed ? <p className="muted">{copy.releaseFailed}</p> : null}
      <ul className="crm-doc-list">
        {checklist.slots.map((slot) => {
          const status = slot.status === "uploaded" ? copy.uploaded : copy.missing;
          const reason = slot.lastReason ? copy.reasons[slot.lastReason] ?? slot.lastReason : "";
          return (
            <li key={slot.id}>
              <bdi>{slot.label}</bdi>
              <span className="muted"> · {status}</span>
              {reason ? (
                <span className="muted">
                  {" "}
                  · {copy.reason}: {reason}
                </span>
              ) : null}
              {slot.href ? (
                <span className="muted">
                  {" "}
                  · <a href={slot.href}>{copy.openFile}</a>
                </span>
              ) : null}
              {slot.remoteId && !slot.remoteId.startsWith("local:") ? (
                <span className="muted"> · {copy.remote} {slot.remoteId}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
