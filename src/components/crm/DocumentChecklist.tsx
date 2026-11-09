"use client";

import { useEffect, useState } from "react";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";

type PreviewFile = { href: string; mime: string };
type Preview = { label: string; files: PreviewFile[]; index: number };

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
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    if (!preview) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPreview(null);
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setPreview((current) => {
        if (!current || current.files.length < 2) return current;
        const index = Math.min(current.files.length - 1, Math.max(0, current.index + step));
        return { ...current, index };
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);
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
              {slot.files.length ? (
                <span className="muted">
                  {" "}
                  ·{" "}
                  <button
                    type="button"
                    className="crm-doc-open"
                    onClick={() => setPreview({ label: slot.label, files: slot.files, index: 0 })}
                  >
                    {copy.openFile}
                  </button>
                </span>
              ) : null}
              {slot.remoteId && !slot.remoteId.startsWith("local:") ? (
                <span className="muted"> · {copy.remote} {slot.remoteId}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {preview ? (
        <div className="crm-doc-preview" role="dialog" aria-modal="true" aria-label={preview.label}>
          <button type="button" className="crm-doc-preview-scrim" aria-label={copy.closeFile} onClick={() => setPreview(null)} />
          <div className={`crm-doc-preview-card${preview.files.length > 1 ? " has-nav" : ""}`}>
            <header>
              <bdi>{preview.label}</bdi>
              {preview.files.length > 1 ? (
                <span className="muted">{preview.index + 1} / {preview.files.length}</span>
              ) : null}
              <button type="button" className="crm-btn-quiet" onClick={() => setPreview(null)}>
                {copy.closeFile}
              </button>
            </header>
            {preview.files.length > 1 ? (
              <button
                type="button"
                className="crm-doc-arrow"
                aria-label={copy.previousFile}
                disabled={preview.index === 0}
                onClick={() => setPreview({ ...preview, index: preview.index - 1 })}
              >
                ‹
              </button>
            ) : null}
            <div className="crm-doc-preview-view">
              {preview.files[preview.index]?.mime.startsWith("image/") ? (
                // The file is the document the operator just chose to preview.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.files[preview.index].href} alt={preview.label} />
              ) : (
                <iframe
                  title={preview.label}
                  src={`${preview.files[preview.index]?.href ?? ""}#navpanes=0&zoom=page-width`}
                />
              )}
            </div>
            {preview.files.length > 1 ? (
              <button
                type="button"
                className="crm-doc-arrow"
                aria-label={copy.nextFile}
                disabled={preview.index === preview.files.length - 1}
                onClick={() => setPreview({ ...preview, index: preview.index + 1 })}
              >
                ›
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
