import type { LeadFields, LeadSchema } from "@/lib/flow/types";

export function LeadFieldsForm({
  action,
  schema,
  fields,
  status,
}: {
  action: string;
  schema: LeadSchema;
  fields: LeadFields;
  status?: string;
}) {
  return (
    <form action={action} method="post" className="stack">
      {status !== undefined ? (
        <fieldset>
          <legend>Lead status</legend>
          {["open", "closed"].map((s) => (
            <label key={s} className="choice">
              <input type="radio" name="status" value={s} defaultChecked={status === s} />
              {s}
            </label>
          ))}
        </fieldset>
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
          <label key={key} className="stack">
            {key.replaceAll("_", " ")}
            <input
              name={`field_${key}`}
              type={spec.type === "email" ? "email" : "text"}
              defaultValue={value}
            />
          </label>
        );
      })}
      <button type="submit">Save fields</button>
    </form>
  );
}
