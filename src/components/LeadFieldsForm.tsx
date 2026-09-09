import { FormSelect } from "@/components/Select";
import type { LeadFields, LeadSchema } from "@/lib/flow/types";
import {
  LEAD_STATUSES,
  leadFieldLabel,
  normalizeLeadStatus,
  type LeadStatusId,
  type UiCopy,
} from "@/lib/ui";

export function LeadFieldsForm({
  ui,
  action,
  schema,
  fields,
  status,
  statusLabels,
  statusLegend,
  saveLabel,
  enumLabels,
}: {
  ui: UiCopy;
  action: string;
  schema: LeadSchema;
  fields: LeadFields;
  status?: string;
  statusLabels?: Record<LeadStatusId, string>;
  statusLegend?: string;
  saveLabel?: string;
  enumLabels?: Record<string, Record<string, string>>;
}) {
  const current = status !== undefined ? normalizeLeadStatus(status) : undefined;
  return (
    <form action={action} method="post" className="stack field-form">
      {current !== undefined ? (
        <label>
          {statusLegend ?? ui.common.status}
          <FormSelect
            name="status"
            defaultValue={current}
            ariaLabel={statusLegend ?? ui.common.status}
            options={LEAD_STATUSES.map((s) => ({ value: s, label: statusLabels?.[s] ?? s }))}
          />
        </label>
      ) : null}
      {Object.entries(schema.fields).map(([key, spec]) => {
        if (
          key === "booking" ||
          key === "booking_confirm" ||
          key === "instagramUsername" ||
          key === "zernioConversationId"
        ) {
          return null;
        }
        const raw = fields[key];
        if (raw != null && typeof raw === "object") return null;
        const value = raw == null ? "" : String(raw);
        const label = leadFieldLabel(ui, key);

        if (spec.type === "enum" && spec.enum) {
          return (
            <label key={key}>
              {label}
              <FormSelect
                name={`field_${key}`}
                defaultValue={value || spec.enum[0]}
                ariaLabel={label}
                options={spec.enum.map((option) => ({
                  value: option,
                  label: enumLabels?.[key]?.[option] ?? option,
                }))}
              />
            </label>
          );
        }

        return (
          <label key={key} className={value ? "" : "field-empty"}>
            {label}
            <input
              name={`field_${key}`}
              type={spec.type === "email" ? "email" : "text"}
              inputMode={spec.type === "email" ? "email" : undefined}
              autoComplete={AUTOCOMPLETE[key] ?? "off"}
              dir={spec.type === "email" || key === "phone" ? "ltr" : "auto"}
              className={spec.type === "email" || key === "phone" ? "ltr-isolate" : undefined}
              defaultValue={value}
              placeholder={label}
            />
          </label>
        );
      })}
      <div className="field-form-actions">
        <button type="submit">{saveLabel ?? ui.common.save}</button>
      </div>
    </form>
  );
}

/** Browser autofill hints for the fields that have a standard meaning. */
const AUTOCOMPLETE: Record<string, string> = {
  name: "name",
  email: "email",
  phone: "tel",
};
