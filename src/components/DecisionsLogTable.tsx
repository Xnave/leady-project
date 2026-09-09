"use client";

import { Fragment, useState, type ReactNode } from "react";
import type { UiCopy } from "@/lib/ui";

export type DecisionLogRow = {
  id: string;
  category: string;
  action: string;
  actorUserId: string;
  actorLabel: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string | Date;
};

function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="ltr-isolate">
      {children}
    </span>
  );
}

function str(details: Record<string, unknown>, key: string): string {
  const v = details[key];
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function actionLabel(ui: UiCopy, row: DecisionLogRow): string {
  if (row.summary.trim()) return row.summary.trim();
  if (row.category === "meeting") {
    if (row.action === "approve") {
      return detailsFlag(row.details, "customerConfirmed")
        ? ui.inbox.decisionLogApprovedByCustomer
        : ui.inbox.decisionLogApproved;
    }
    if (row.action === "decline") return ui.inbox.decisionLogDeclined;
    if (row.action === "reschedule") return ui.inbox.decisionLogRescheduled;
  }
  return `${row.category}:${row.action}`;
}

function detailsFlag(details: Record<string, unknown>, key: string): boolean {
  return Boolean(details[key]);
}

function actorDisplay(ui: UiCopy, row: DecisionLogRow): string {
  if (row.actorUserId === "customer" || row.actorLabel === "customer") {
    return ui.inbox.decisionLogActorCustomer;
  }
  if (row.actorLabel === "admin" || row.actorUserId === "owner") {
    return ui.inbox.decisionLogActorAdmin;
  }
  return row.actorLabel || row.actorUserId || ui.inbox.decisionLogActorAdmin;
}

function badgeClass(row: DecisionLogRow): string {
  if (row.action === "approve") return "badge";
  if (row.action === "decline" || row.action === "reschedule") return "badge badge-warn";
  return "badge";
}

function secondaryCell(row: DecisionLogRow): string {
  if (row.category === "meeting") {
    const alt = str(row.details, "alternativeSlot");
    const slot = str(row.details, "slotText");
    if (row.action === "reschedule" && alt) return alt;
    return slot || alt || "—";
  }
  return "—";
}

export function DecisionsLogTable({
  ui,
  rows,
  emptyLabel,
  locale,
}: {
  ui: UiCopy;
  rows: DecisionLogRow[];
  emptyLabel: string;
  locale: string;
}) {
  const [openId, setOpenId] = useState<string | null>(rows[0]?.id ?? null);

  if (rows.length === 0) {
    return <p className="muted lead-meetings-empty">{emptyLabel}</p>;
  }

  return (
    <div className="lead-meetings-table-wrap">
      <table className="lead-meetings-table">
        <thead>
          <tr>
            <th scope="col">{ui.inbox.decisionLogAction}</th>
            <th scope="col">{ui.inbox.decisionLogWhen}</th>
            <th scope="col">{ui.inbox.decisionLogActor}</th>
            <th scope="col">{ui.inbox.summaryWhen}</th>
            <th scope="col" className="lead-meetings-actions">
              <span className="sr-only">{ui.common.details}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = openId === row.id;
            const when = new Date(row.createdAt).toLocaleString(locale, {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const note = str(row.details, "note").trim();
            const customReply = str(row.details, "customReply").trim();
            const previousSlot = str(row.details, "previousSlot").trim();
            const alternativeSlot = str(row.details, "alternativeSlot").trim();
            const hasDetails = Boolean(
              note ||
                customReply ||
                previousSlot ||
                (row.action === "reschedule" && alternativeSlot) ||
                Object.keys(row.details).some(
                  (k) =>
                    !["note", "customReply", "previousSlot", "alternativeSlot", "slotText", "meetingId", "customerConfirmed"].includes(
                      k,
                    ) && row.details[k] != null && row.details[k] !== "",
                ),
            );
            return (
              <Fragment key={row.id}>
                <tr
                  className={`lead-meetings-row${expanded ? " is-open" : ""}`}
                  onClick={() => setOpenId(expanded ? null : row.id)}
                >
                  <td>
                    <span className={badgeClass(row)}>{actionLabel(ui, row)}</span>
                  </td>
                  <td>
                    <Ltr>{when}</Ltr>
                  </td>
                  <td>{actorDisplay(ui, row)}</td>
                  <td>{secondaryCell(row)}</td>
                  <td className="lead-meetings-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-expanded={expanded}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(expanded ? null : row.id);
                      }}
                    >
                      {expanded ? ui.common.close : ui.common.details}
                    </button>
                  </td>
                </tr>
                {expanded ? (
                  <tr className="lead-meetings-detail-row">
                    <td colSpan={5}>
                      <div className="lead-meetings-detail stack">
                        {!hasDetails ? (
                          <p className="muted">{ui.common.empty}</p>
                        ) : null}
                        {row.category === "meeting" && row.action === "reschedule" && previousSlot ? (
                          <p>
                            {ui.inbox.decisionLogPreviousSlot}: {previousSlot}
                          </p>
                        ) : null}
                        {row.category === "meeting" &&
                        row.action === "reschedule" &&
                        alternativeSlot ? (
                          <p>
                            {ui.meeting.alternativeSlotLabel}: {alternativeSlot}
                          </p>
                        ) : null}
                        {note ? (
                          <p>
                            {ui.inbox.declineNoteLabel}: {note}
                          </p>
                        ) : null}
                        {customReply ? (
                          <p style={{ whiteSpace: "pre-wrap" }}>
                            {ui.inbox.customReplyLabel}: {customReply}
                          </p>
                        ) : null}
                        {row.category !== "meeting"
                          ? Object.entries(row.details)
                              .filter(([, v]) => v != null && v !== "")
                              .map(([key, value]) => (
                                <p key={key}>
                                  {key}: {typeof value === "string" ? value : JSON.stringify(value)}
                                </p>
                              ))
                          : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
