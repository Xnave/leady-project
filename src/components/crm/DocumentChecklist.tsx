"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";

type Slot = NonNullable<LeadViewDTO["documents"]>["slots"][number];
type GalleryFile = { key: string; href: string; mime: string; label: string; slotId: string; slotIds: string[] };
type Preview = { files: GalleryFile[]; index: number };

function galleryOf(slots: Slot[]): GalleryFile[] {
  const files: GalleryFile[] = [];
  for (const slot of slots) {
    slot.files.forEach((file, index) => {
      files.push({
        key: `${slot.id}:${index}`,
        href: file.href,
        mime: file.mime,
        label: slot.label,
        slotId: slot.id,
        slotIds: slot.slotIds,
      });
    });
  }
  return files;
}

export function DocumentChecklist({
  leadId,
  checklist,
  ui,
  lang,
  onReturn,
}: {
  leadId: string;
  checklist: LeadViewDTO["documents"];
  ui: UiCopy;
  lang: "he" | "en";
  /** Present while the checklist review task is open. Marks send the same return as that task. */
  onReturn?: (form: FormData) => Promise<string | null>;
}) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fixError, setFixError] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!preview) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!(document.activeElement instanceof HTMLTextAreaElement)) dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [preview]);
  function step(delta: number) {
    setPreview((current) => {
      if (!current || current.files.length < 2) return current;
      const index = Math.min(current.files.length - 1, Math.max(0, current.index + delta));
      return index === current.index ? current : { ...current, index };
    });
  }
  useEffect(() => {
    if (!preview) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreview(null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      step(event.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey, true);
    // A click inside the file hands the keys to the viewer. Pull them back so
    // left and right keep moving between files.
    function pullFocus() {
      if (document.activeElement instanceof HTMLIFrameElement) dialogRef.current?.focus();
    }
    window.addEventListener("blur", pullFocus);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", pullFocus);
    };
  }, [preview]);
  if (!checklist || checklist.slots.length === 0) return null;
  const copy = ui.documentsUi;
  const gallery = galleryOf(checklist.slots);
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
  function openSlot(slot: Slot) {
    const index = gallery.findIndex((file) => file.key.startsWith(`${slot.id}:`));
    if (index < 0) return;
    setPreview({ files: gallery, index });
  }
  const current = preview ? preview.files[preview.index] : null;
  const markedIds = checklist.slots.filter((slot) => slot.id in saved && slot.status === "uploaded").map((slot) => slot.id);
  const dir = lang === "he" ? "rtl" : "ltr";
  function markInvalid(slotId: string) {
    setDrafts((currentDrafts) => ({ ...currentDrafts, [slotId]: currentDrafts[slotId] ?? saved[slotId] ?? "" }));
    setFixError(null);
    requestAnimationFrame(() => noteRef.current?.focus());
  }
  function saveNote(slotId: string) {
    const note = (drafts[slotId] ?? "").trim();
    if (!note) {
      setFixError(copy.returnNeedOne);
      requestAnimationFrame(() => noteRef.current?.focus());
      return;
    }
    setSaved((currentNotes) => ({ ...currentNotes, [slotId]: note }));
    setDrafts((currentDrafts) => ({ ...currentDrafts, [slotId]: note }));
    setFixError(null);
  }
  function cancelNote(slotId: string) {
    const kept = saved[slotId];
    const draft = drafts[slotId] ?? "";
    setFixError(null);
    if (kept && draft.trim() !== kept) {
      setDrafts((currentDrafts) => ({ ...currentDrafts, [slotId]: kept }));
      return;
    }
    setDrafts((currentDrafts) => {
      const next = { ...currentDrafts };
      delete next[slotId];
      return next;
    });
    setSaved((currentNotes) => {
      const next = { ...currentNotes };
      delete next[slotId];
      return next;
    });
  }
  async function sendFixes() {
    if (!onReturn || !checklist) return;
    const chosen = checklist.slots.filter((slot) => markedIds.includes(slot.id));
    if (!chosen.length) return;
    const form = new FormData();
    form.set("mode", "return_files");
    form.set("approved", "no");
    for (const slot of chosen) {
      const group = slot.slotIds.join("|");
      form.append("returnGroup", group);
      form.set(`returnNote__${group}`, saved[slot.id].trim());
    }
    setFixBusy(true);
    setFixError(null);
    const err = await onReturn(form);
    setFixBusy(false);
    if (err) {
      setFixError(ui.crm.task.failed);
      return;
    }
    setSaved({});
    setDrafts({});
    setPreview(null);
  }
  const dialog = preview && current ? (
    <div
      ref={dialogRef}
      className="crm-doc-preview"
      role="dialog"
      aria-modal="true"
      aria-label={current.label}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest("button, a, iframe, textarea, input")) return;
        swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
        step(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => {
        swipe.current = null;
      }}
    >
      <button type="button" className="crm-doc-preview-scrim" aria-label={copy.closeFile} onClick={() => setPreview(null)} />
      <div className={`crm-doc-preview-card${preview.files.length > 1 ? " has-nav" : ""}`}>
        <header>
          <bdi>{current.label}</bdi>
          {preview.files.length > 1 ? (
            <span className="muted">{preview.index + 1} / {preview.files.length}</span>
          ) : null}
          <button type="button" className="crm-btn-quiet" onClick={() => setPreview(null)}>
            {copy.closeFile}
          </button>
        </header>
        {onReturn ? (
          <div className="crm-doc-preview-review" dir={dir}>
            {current.slotId in drafts ? (
              <>
                <textarea
                  ref={noteRef}
                  rows={2}
                  value={drafts[current.slotId] ?? ""}
                  placeholder={copy.returnNotePlaceholder}
                  aria-label={copy.returnNote}
                  onChange={(event) => {
                    const note = event.target.value;
                    setDrafts((currentDrafts) => ({ ...currentDrafts, [current.slotId]: note }));
                  }}
                />
                <div className="crm-doc-preview-actions">
                  <button type="button" className="btn" onClick={() => saveNote(current.slotId)}>
                    {copy.saveMark}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => cancelNote(current.slotId)}>
                    {copy.cancelMark}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="crm-btn-quiet" onClick={() => markInvalid(current.slotId)}>
                {copy.markInvalid}
              </button>
            )}
            {fixError ? <p className="crm-task-error" role="alert">{fixError}</p> : null}
          </div>
        ) : null}
        {preview.files.length > 1 ? (
          <button
            type="button"
            className="crm-doc-arrow"
            aria-label={copy.previousFile}
            disabled={preview.index === 0}
            onClick={() => step(-1)}
          >
            ‹
          </button>
        ) : null}
        <div className="crm-doc-preview-view">
          {current.mime.startsWith("image/") ? (
            // The file is the document the operator just chose to preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.href} alt={current.label} />
          ) : (
            <iframe title={current.label} src={`${current.href}#navpanes=0&zoom=page-width`} />
          )}
        </div>
        {preview.files.length > 1 ? (
          <button
            type="button"
            className="crm-doc-arrow"
            aria-label={copy.nextFile}
            disabled={preview.index === preview.files.length - 1}
            onClick={() => step(1)}
          >
            ›
          </button>
        ) : null}
        {onReturn && markedIds.length ? (
          <div className="crm-doc-preview-foot" dir={dir}>
            <button type="button" className="btn" disabled={fixBusy} aria-busy={fixBusy} onClick={() => void sendFixes()}>
              {copy.sendToFix.replace("{count}", String(markedIds.length))}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;
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
                  <button type="button" className="crm-doc-open" onClick={() => openSlot(slot)}>
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
      {mounted && dialog ? createPortal(dialog, document.body) : null}
    </section>
  );
}
