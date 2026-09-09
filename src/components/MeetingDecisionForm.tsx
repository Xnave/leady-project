"use client";

import { useState } from "react";

type Labels = {
  need: string;
  name: string;
  phone: string;
  email: string;
  approve: string;
  decline: string;
  reschedule: string;
  alternativeSlotLabel: string;
  alternativeSlotPlaceholder: string;
  visitDefault: string;
  noteLabel?: string;
  notePlaceholder?: string;
  customReplyLabel?: string;
  customReplyPlaceholder?: string;
  updateDecision?: string;
  currentStatus?: string;
  changeDecision?: string;
  cancel?: string;
};

export function MeetingDecisionForm({
  meetingId,
  pending,
  status,
  summary,
  labels,
  redirect,
}: {
  meetingId: string;
  pending: boolean;
  status?: string;
  summary?: {
    name?: string;
    phone?: string;
    email?: string;
    need?: string;
    slot?: string;
    kind?: string;
  };
  labels: Labels;
  redirect?: string;
}) {
  const [editing, setEditing] = useState(pending);
  const [mode, setMode] = useState<"approve" | "decline" | "reschedule">("approve");
  const statusLabel = status ?? (pending ? "pending" : "");
  const locked = !pending && !editing;

  return (
    <form action={`/api/meetings/${meetingId}/decide`} method="post" className="stack">
      {redirect ? <input type="hidden" name="redirect" value={redirect} /> : null}
      <input type="hidden" name="decision" value={mode} />
      {summary ? (
        <div className="stage-node">
          {summary.kind || summary.slot ? (
            <p>
              <strong>{summary.kind ?? labels.visitDefault}</strong>
              {summary.slot ? ` · ${summary.slot}` : ""}
            </p>
          ) : null}
          {summary.need ? (
            <p>
              {labels.need}: {summary.need}
            </p>
          ) : null}
          {summary.name ? (
            <p>
              {labels.name}: {summary.name}
            </p>
          ) : null}
          {summary.phone ? (
            <p>
              {labels.phone}:{" "}
              <span dir="ltr" className="ltr-isolate">
                {summary.phone}
              </span>
            </p>
          ) : null}
          {summary.email ? (
            <p>
              {labels.email}: {summary.email}
            </p>
          ) : null}
        </div>
      ) : null}
      {!pending && statusLabel ? (
        <p className="muted">
          {labels.currentStatus ?? "Current decision"}:{" "}
          <span className="badge">{statusLabel}</span>
        </p>
      ) : null}

      {locked ? (
        <div className="row-actions">
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            {labels.changeDecision ?? "Change decision"}
          </button>
        </div>
      ) : (
        <>
          <div className="radio-card-grid compact">
            <label className="radio-card">
              <input
                type="radio"
                name="decision_ui"
                checked={mode === "approve"}
                onChange={() => setMode("approve")}
              />
              <div className="radio-card-body">
                <strong>{labels.approve}</strong>
              </div>
            </label>
            <label className="radio-card">
              <input
                type="radio"
                name="decision_ui"
                checked={mode === "decline"}
                onChange={() => setMode("decline")}
              />
              <div className="radio-card-body">
                <strong>{labels.decline}</strong>
              </div>
            </label>
            <label className="radio-card">
              <input
                type="radio"
                name="decision_ui"
                checked={mode === "reschedule"}
                onChange={() => setMode("reschedule")}
              />
              <div className="radio-card-body">
                <strong>{labels.reschedule}</strong>
              </div>
            </label>
          </div>

          {mode === "reschedule" ? (
            <label className="stack">
              <span className="muted">{labels.alternativeSlotLabel}</span>
              <input
                name="alternativeSlot"
                required
                placeholder={labels.alternativeSlotPlaceholder}
                dir="auto"
              />
            </label>
          ) : null}

          <label className="stack">
            <span className="muted">{labels.noteLabel ?? "Note for the customer (optional)"}</span>
            <textarea
              className="note-input"
              name="note"
              placeholder={labels.notePlaceholder ?? "Added under the default message"}
              rows={2}
            />
          </label>
          <label className="stack">
            <span className="muted">
              {labels.customReplyLabel ?? "Custom reply (optional — approve only, replaces template)"}
            </span>
            <textarea
              className="note-input"
              name="customReply"
              placeholder={labels.customReplyPlaceholder ?? "Leave empty to use the default message"}
              rows={3}
              disabled={mode !== "approve"}
            />
          </label>
          <div className="row-actions">
            <button type="submit">
              {mode === "approve"
                ? labels.approve
                : mode === "decline"
                  ? labels.decline
                  : labels.reschedule}
            </button>
            {!pending ? (
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                {labels.cancel ?? "Cancel"}
              </button>
            ) : null}
          </div>
        </>
      )}
    </form>
  );
}
