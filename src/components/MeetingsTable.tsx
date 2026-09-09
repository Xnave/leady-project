"use client";

import { Fragment, useState, type ReactNode } from "react";
import { MeetingDecisionForm } from "@/components/MeetingDecisionForm";
import type { UiCopy } from "@/lib/ui";

export type MeetingRow = {
  id: string;
  status: string;
  kind: string;
  slotText: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  needText: string | null;
  conversationId: string;
  awaitingCustomerConfirm?: boolean;
  customerConfirmed?: boolean;
};

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
  noteLabel: string;
  notePlaceholder: string;
  customReplyLabel: string;
  customReplyPlaceholder: string;
  updateDecision: string;
  currentStatus: string;
  changeDecision: string;
  cancel?: string;
};

function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="ltr-isolate">
      {children}
    </span>
  );
}

function statusLabel(ui: UiCopy, meeting: MeetingRow): string {
  if (meeting.awaitingCustomerConfirm) return ui.inbox.awaitingCustomer;
  if (meeting.customerConfirmed) return ui.inbox.customerConfirmed;
  if (meeting.status === "pending") return ui.common.pending;
  if (meeting.status === "approved") return ui.meeting.approved;
  if (meeting.status === "rejected") return ui.meeting.rejected;
  return meeting.status;
}

function statusClass(meeting: MeetingRow): string {
  if (meeting.awaitingCustomerConfirm) return "badge badge-warn";
  if (meeting.status === "approved" || meeting.customerConfirmed) return "badge";
  if (meeting.status === "rejected") return "badge badge-warn";
  return "badge";
}

export function MeetingsTable({
  ui,
  leadId,
  meetings,
  labels,
  emptyLabel,
  allowDecide,
}: {
  ui: UiCopy;
  leadId: string;
  meetings: MeetingRow[];
  labels: Labels;
  emptyLabel: string;
  allowDecide: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(meetings[0]?.id ?? null);

  if (meetings.length === 0) {
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
          {meetings.map((meeting) => {
            const expanded = openId === meeting.id;
            return (
              <Fragment key={meeting.id}>
                <tr
                  className={`lead-meetings-row${expanded ? " is-open" : ""}`}
                  onClick={() => setOpenId(expanded ? null : meeting.id)}
                >
                  <td>
                    <span className={statusClass(meeting)}>{statusLabel(ui, meeting)}</span>
                  </td>
                  <td>{meeting.slotText || ui.common.empty}</td>
                  <td>{meeting.contactName || ui.common.empty}</td>
                  <td>
                    {meeting.contactPhone ? <Ltr>{meeting.contactPhone}</Ltr> : ui.common.empty}
                  </td>
                  <td className="lead-meetings-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-expanded={expanded}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(expanded ? null : meeting.id);
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
                        {meeting.needText ? (
                          <p>
                            {ui.common.need}: {meeting.needText}
                          </p>
                        ) : null}
                        {meeting.contactEmail ? (
                          <p>
                            {ui.common.email}: <Ltr>{meeting.contactEmail}</Ltr>
                          </p>
                        ) : null}
                        {meeting.kind ? <p className="muted">{meeting.kind}</p> : null}
                        {allowDecide ? (
                          <MeetingDecisionForm
                            meetingId={meeting.id}
                            pending={
                              meeting.status === "pending" && !meeting.awaitingCustomerConfirm
                            }
                            status={statusLabel(ui, meeting)}
                            redirect={`/leads/${leadId}?c=${meeting.conversationId}`}
                            labels={labels}
                            summary={{
                              name: meeting.contactName ?? undefined,
                              phone: meeting.contactPhone ?? undefined,
                              email: meeting.contactEmail ?? undefined,
                              need: meeting.needText ?? undefined,
                              slot: meeting.slotText,
                              kind: meeting.kind,
                            }}
                          />
                        ) : meeting.awaitingCustomerConfirm ? (
                          <p className="muted">{ui.inbox.awaitingCustomerHint}</p>
                        ) : null}
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
