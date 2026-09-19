"use client";

import { Fragment, useState, type ReactNode } from "react";
import {
  RequestDecisionForm,
  type RequestDecisionLabels,
  type RequestSummaryLine,
} from "@/components/RequestDecisionForm";
import { formatPhoneDisplay } from "@/lib/leads";
import type { UiCopy } from "@/lib/ui";

/**
 * A request as the operator sees it. `lines` and `headline` are rendered from the
 * request's field schema on the server, so this table works for any vertical.
 */
export type RequestTableRow = {
  id: string;
  capabilityId: string;
  status: string;
  /** Formatted time — "Wed 17:00" for a point, "2026-02-08 → 2026-02-10" for a span. */
  timeText: string;
  timeShape: "point" | "span";
  headline?: string;
  contactName: string;
  contactPhone: string;
  lines: RequestSummaryLine[];
  conversationId: string;
  awaitingCustomerConfirm?: boolean;
  customerConfirmed?: boolean;
};

function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="ltr-isolate">
      {children}
    </span>
  );
}

function statusLabel(ui: UiCopy, row: RequestTableRow): string {
  if (row.awaitingCustomerConfirm) return ui.inbox.awaitingCustomer;
  if (row.customerConfirmed) return ui.inbox.customerConfirmed;
  if (row.status === "pending") return ui.common.pending;
  const decided = row.capabilityId === "reservations" ? ui.reservation : ui.meeting;
  if (row.status === "approved") return decided.approved;
  if (row.status === "rejected") return decided.rejected;
  return row.status;
}

function statusClass(row: RequestTableRow): string {
  if (row.awaitingCustomerConfirm) return "badge badge-warn";
  if (row.status === "approved" || row.customerConfirmed) return "badge";
  if (row.status === "rejected") return "badge badge-warn";
  return "badge";
}

export function RequestsTable({
  ui,
  leadId,
  requests,
  labels,
  emptyLabel,
  allowDecide,
  latestConversationId,
  decisionsLockedHint,
}: {
  ui: UiCopy;
  leadId: string;
  requests: RequestTableRow[];
  labels: RequestDecisionLabels;
  emptyLabel: string;
  allowDecide: boolean;
  /** When set, only requests from this conversation can be decided. */
  latestConversationId?: string;
  decisionsLockedHint?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(requests[0]?.id ?? null);

  if (requests.length === 0) {
    return <p className="muted lead-meetings-empty">{emptyLabel}</p>;
  }

  return (
    <div className="lead-meetings-table-wrap">
      <table className="lead-meetings-table">
        <thead>
          <tr>
            <th scope="col">{ui.common.status}</th>
            <th scope="col">{ui.inbox.summaryWhen}</th>
            <th scope="col">{ui.common.name}</th>
            <th scope="col">{ui.common.phone}</th>
            <th scope="col" className="lead-meetings-actions">
              <span className="sr-only">{ui.common.details}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((row) => {
            const expanded = openId === row.id;
            const canDecide =
              allowDecide &&
              (!latestConversationId ||
                row.conversationId === latestConversationId ||
                // Pending approval work stays actionable even if a newer thread exists.
                row.status === "pending" ||
                Boolean(row.awaitingCustomerConfirm));
            return (
              <Fragment key={row.id}>
                <tr
                  className={`lead-meetings-row${expanded ? " is-open" : ""}`}
                  onClick={() => setOpenId(expanded ? null : row.id)}
                >
                  <td>
                    <span className={statusClass(row)}>{statusLabel(ui, row)}</span>
                  </td>
                  <td>{row.timeText || ui.common.empty}</td>
                  <td>{row.contactName || ui.common.empty}</td>
                  <td>
                    {row.contactPhone ? (
                      <Ltr>{formatPhoneDisplay(row.contactPhone)}</Ltr>
                    ) : (
                      ui.common.empty
                    )}
                  </td>
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
                        {canDecide ? (
                          <RequestDecisionForm
                            requestId={row.id}
                            pending={
                              row.status === "pending" && !row.awaitingCustomerConfirm
                            }
                            status={statusLabel(ui, row)}
                            timeShape={row.timeShape}
                            timeText={row.timeText}
                            headline={row.headline}
                            redirect={`/leads/${leadId}?c=${row.conversationId}`}
                            labels={labels}
                            lines={row.lines}
                          />
                        ) : (
                          <>
                            {row.lines.map((line) => (
                              <p key={`${line.label}:${line.value}`}>
                                {line.label}:{" "}
                                {line.ltr ? <Ltr>{line.value}</Ltr> : line.value}
                              </p>
                            ))}
                            {row.awaitingCustomerConfirm ? (
                              <p className="muted">{ui.inbox.awaitingCustomerHint}</p>
                            ) : allowDecide && decisionsLockedHint ? (
                              <p className="muted">{decisionsLockedHint}</p>
                            ) : null}
                          </>
                        )}
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
