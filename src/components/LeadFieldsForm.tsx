import type { LeadFields, LeadSchema } from "@/lib/flow/types";
import { LEAD_STATUSES, normalizeLeadStatus, type LeadStatusId } from "@/lib/ui";

export function LeadFieldsForm({
  action,
  schema,
  fields,
  status,
  statusLabels,
  statusLegend,
  saveLabel,
}: {
  action: string;
  schema: LeadSchema;
  fields: LeadFields;
  status?: string;
  statusLabels?: Record<LeadStatusId, string>;
  statusLegend?: string;
  saveLabel?: string;
}) {
  const current = status !== undefined ? normalizeLeadStatus(status) : undefined;
  return (
    <form action={action} method="post" className="stack">
      {current !== undefined ? (
        <label>
          {statusLegend ?? statusLabels?.[current] ?? "Status"}
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
        if (spec.type === "enum" && spec.enum) {
          return (
            <fieldset key={key}>
              <legend>{key.replaceAll("_", " ")}</legend>
              {spec.enum.map((option) => (
                <label key={option} className="choice">
                  <input
                    type="radio"
                    name={`field_${key}`}
                    value={option}
                    defaultChecked={value === option}
                  />
                  {option}
                </label>
              ))}
            </fieldset>
          );
        }
        return (
          <label key={key}>
            {key.replaceAll("_", " ")}
            <input
              name={`field_${key}`}
              type={spec.type === "email" ? "email" : "text"}
              defaultValue={value}
            />
          </label>
        );
      })}
      <button type="submit">{saveLabel ?? "Save"}</button>
    </form>
  );
}
