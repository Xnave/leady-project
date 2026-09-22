"use client";

import { useMemo, useState, type ReactNode } from "react";
import { LeadFieldsForm } from "@/components/LeadFieldsForm";
import { isBookingSessionKey } from "@/lib/flow/booking";
import type { LeadFields, LeadSchema } from "@/lib/flow/types";
import { formatPhoneDisplay } from "@/lib/leads";
import { intentLabel, requestKindLabel } from "@/lib/ui/labels";
import type { UiCopy } from "@/lib/ui";

const HIDDEN_CAPTURED = new Set([
  "instagramUsername",
  "zernioConversationId",
  "booking_confirm",
  "booking_flow",
  "booking",
  "staff_slot_offer",
  "time_preference",
  "name_collected_by_agent",
  "force_fresh_inbound",
  "intent", // already shown in the profile block
  "meetingId",
]);

function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="ltr-isolate">
      {children}
    </span>
  );
}

function formatCapturedValue(key: string, value: unknown, ui: UiCopy): string {
  if (value == null || value === "") return "";
  if (key === "meetingId") return "";
  if (key === "intent" && typeof value === "string") {
    return intentLabel(ui, value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (key === "phone") return formatPhoneDisplay(String(value));
    return String(value);
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const statusRaw = typeof rec.status === "string" ? rec.status : "";
    const status =
      statusRaw === "pending"
        ? ui.common.pending
        : statusRaw === "approved"
          ? ui.meeting.approved
          : statusRaw === "rejected"
            ? ui.meeting.rejected
            : statusRaw;
    const when = typeof rec.when === "string" ? rec.when : "";
    const kindRaw = typeof rec.kind === "string" ? rec.kind.trim() : "";
    const kind = kindRaw && kindRaw !== "visit" ? requestKindLabel(ui, kindRaw) : "";
    return [status, when, kind].filter(Boolean).join(" · ");
  }
  return "";
}

/** Read-only captured fields with optional edit form — same UX as the lead detail page. */
export function CapturedFieldsBlock({
  ui,
  leadId,
  schema,
  fields,
  status,
}: {
  ui: UiCopy;
  leadId: string;
  schema: LeadSchema;
  fields: LeadFields;
  status?: string;
}) {
  const [editingFields, setEditingFields] = useState(false);

  const capturedEntries = useMemo(() => {
    return Object.entries(fields)
      .filter(([key]) => !HIDDEN_CAPTURED.has(key) && !isBookingSessionKey(key))
      .map(([key, value]) => ({
        key,
        value: formatCapturedValue(key, value, ui),
        ltr: key === "phone" || key === "email",
      }))
      .filter((row) => row.value);
  }, [fields, ui]);

  const crmSchema: LeadSchema = useMemo(
    () => ({
      fields: Object.fromEntries(
        Object.entries(schema.fields).filter(([key]) => !isBookingSessionKey(key)),
      ),
    }),
    [schema],
  );
  const crmFields: LeadFields = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(fields).filter(([key]) => !isBookingSessionKey(key)),
      ),
    [fields],
  );

  const formId = `captured-fields-${leadId}`;

  return (
    <div className="lead-captured-block">
      <div className="row-actions" style={{ justifyContent: "space-between" }}>
        <h3 className="lead-subhead">{ui.common.captured}</h3>
        {editingFields ? (
          <div className="row-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setEditingFields(false)}
            >
              {ui.common.cancel}
            </button>
            <button type="submit" form={formId} className="btn-secondary">
              {ui.common.save}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setEditingFields(true)}
          >
            {ui.common.editDetails}
          </button>
        )}
      </div>
      {editingFields ? (
        <LeadFieldsForm
          ui={ui}
          formId={formId}
          hideActions
          action={`/api/leads/${leadId}/fields`}
          schema={crmSchema}
          fields={crmFields}
          status={status}
          statusLabels={ui.status}
          statusLegend={ui.common.status}
          saveLabel={ui.common.save}
          enumLabels={{ intent: ui.intents }}
        />
      ) : capturedEntries.length > 0 ? (
        <dl className="detail-list">
          {capturedEntries.map((row) => (
            <div key={row.key} className="detail-row">
              <dt>{ui.leadFields[row.key] ?? row.key}</dt>
              <dd>{row.ltr ? <Ltr>{row.value}</Ltr> : row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">{ui.common.empty}</p>
      )}
    </div>
  );
}
