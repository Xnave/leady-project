"use client";

import { useState } from "react";

/**
 * One decision form for every approval vertical.
 *
 * The summary is not hardcoded per domain: the caller renders the request's field
 * schema into `lines` (see `confirmLines` in `@/lib/flow/fields`), so a new vertical
 * shows up here with no change to this component. Only the reschedule inputs vary,
 * and they follow the shape of the time spine.
 */
export type RequestSummaryLine = {
  label: string;
  value: string;
  /** Isolate as LTR inside an RTL layout (phone numbers, emails, URLs). */
  ltr?: boolean;
};

export type RequestDecisionLabels = {
  approve: string;
  decline: string;
  reschedule: string;
  /** Reschedule input label for a point in time. */
  alternativeSlotLabel: string;
  alternativeSlotPlaceholder?: string;
  /** Reschedule input labels for a span. */
  alternativeStartLabel?: string;
  alternativeEndLabel?: string;
  noteLabel?: string;
  notePlaceholder?: string;
  customReplyLabel?: string;
  customReplyPlaceholder?: string;
  currentStatus?: string;
  changeDecision?: string;
  cancel?: string;
};

export function RequestDecisionForm({
  requestId,
  pending,
  status,
  timeShape,
  timeText,
  headline,
  lines,
  labels,
  redirect,
}: {
  requestId: string;
  pending: boolean;
  status?: string;
  /** A point in time takes one alternative; a span takes two dates. */
  timeShape: "point" | "span";
  /** The request's time, already formatted for display. */
  timeText?: string;
  /** Optional prefix shown before the time, e.g. the visit type. */
  headline?: string;
  lines?: RequestSummaryLine[];
  labels: RequestDecisionLabels;
  redirect?: string;
}) {
  const [editing, setEditing] = useState(pending);
  const [mode, setMode] = useState<"approve" | "decline" | "reschedule">("approve");
  const statusLabel = status ?? (pending ? "pending" : "");
  const locked = !pending && !editing;
  const summaryLines = lines ?? [];
  const hasSummary = Boolean(timeText || headline || summaryLines.length);

  return (
    <form
      action={`/api/requests/${requestId}/decide`}
      method="post"
      className="stack"
    >
      {redirect ? <input type="hidden" name="redirect" value={redirect} /> : null}
      <input type="hidden" name="decision" value={mode} />

      {hasSummary ? (
        <div className="stage-node">
          {headline || timeText ? (
            <p>
              {headline ? <strong>{headline}</strong> : null}
              {headline && timeText ? " · " : ""}
              {timeText ? <strong>{timeText}</strong> : null}
            </p>
          ) : null}
          {summaryLines.map((line) => (
            <p key={`${line.label}:${line.value}`}>
              {line.label}:{" "}
              {line.ltr ? (
                <span dir="ltr" className="ltr-isolate">
                  {line.value}
                </span>
              ) : (
                line.value
              )}
            </p>
          ))}
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
            {(["approve", "decline", "reschedule"] as const).map((option) => (
              <label className="radio-card" key={option}>
                <input
                  type="radio"
                  name="decision_ui"
                  checked={mode === option}
                  onChange={() => setMode(option)}
                />
                <div className="radio-card-body">
                  <strong>{labels[option]}</strong>
                </div>
              </label>
            ))}
          </div>

          {mode === "reschedule" && timeShape === "point" ? (
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

          {mode === "reschedule" && timeShape === "span" ? (
            <div className="stack">
              <label>
                {labels.alternativeStartLabel ?? labels.alternativeSlotLabel}
                <input name="alternativeCheckIn" type="date" required />
              </label>
              <label>
                {labels.alternativeEndLabel ?? labels.alternativeSlotLabel}
                <input name="alternativeCheckOut" type="date" required />
              </label>
            </div>
          ) : null}

          <label className="stack">
            <span className="muted">
              {labels.noteLabel ?? "Note for the customer (optional)"}
            </span>
            <textarea
              className="note-input"
              name="note"
              placeholder={labels.notePlaceholder ?? "Added under the default message"}
              rows={2}
            />
          </label>
          <label className="stack">
            <span className="muted">
              {labels.customReplyLabel ??
                "Custom reply (optional — approve only, replaces template)"}
            </span>
            <textarea
              className="note-input"
              name="customReply"
              placeholder={
                labels.customReplyPlaceholder ?? "Leave empty to use the default message"
              }
              rows={3}
              disabled={mode !== "approve"}
            />
          </label>
          <div className="row-actions">
            <button type="submit">{labels[mode]}</button>
            {!pending ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setEditing(false)}
              >
                {labels.cancel ?? "Cancel"}
              </button>
            ) : null}
          </div>
        </>
      )}
    </form>
  );
}
