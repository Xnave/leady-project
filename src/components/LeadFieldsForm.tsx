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
          <select name="status" defaultValue={current}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabels?.[s] ?? s}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {Object.entries(schema.fields).map(([key, spec]) => {
        const value = fields[key] == null ? "" : String(fields[key]);
        const label = leadFieldLabel(ui, key);

        if (spec.type === "enum" && spec.enum) {
          return (
            <fieldset key={key}>
              <legend>{label}</legend>
              <div className="chip-row">
                {spec.enum.map((option) => (
                  <label key={option} className="chip-toggle">
                    <input
                      type="radio"
                      name={`field_${key}`}
                      value={option}
                      defaultChecked={value === option}
                    />
                    <span>{enumLabels?.[key]?.[option] ?? option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
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
