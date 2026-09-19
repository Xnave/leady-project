/**
 * Operator-facing rendering of a request.
 *
 * The CRM does not branch per vertical: it turns the request's stored values into
 * `FieldSpec`s and lets the field kit produce the labels and formatting. A new
 * vertical shows up in the inbox and the decisions log with no UI change.
 */
import type { RequestSummaryLine } from "@/components/RequestDecisionForm";
import { confirmLines, type FieldSpec } from "@/lib/flow/fields";
import type { RequestRow } from "@/lib/requests";

/**
 * Which `data` keys are internal to a capability (snapshots the operator already
 * sees elsewhere) and which one reads as the headline next to the time.
 */
const CAPABILITY_VIEW: Record<
  string,
  { headlineKey?: string; hiddenKeys: readonly string[] }
> = {
  booking: {
    headlineKey: "visit_kind",
    // venue/hours are tenant snapshots; visit_kind is shown as the headline.
    hiddenKeys: ["venue", "hours", "visit_kind"],
  },
  reservations: { hiddenKeys: [] },
};

/** A span renders two date inputs on reschedule; a point renders one free-text slot. */
export function requestTimeShape(request: {
  endAt?: Date | null;
}): "point" | "span" {
  return request.endAt ? "span" : "point";
}

/** Headline shown beside the time, when the vertical has one (e.g. the visit type). */
export function requestHeadline(request: RequestRow): string | undefined {
  const view = CAPABILITY_VIEW[request.capabilityId];
  if (!view?.headlineKey) return undefined;
  const raw = String(request.data[view.headlineKey] ?? "").trim();
  // "visit" is the default kind and adds nothing next to the date.
  if (!raw || raw === request.kind) return undefined;
  return raw;
}

function specFor(key: string, label?: string): FieldSpec {
  const labels = label ? { en: label, he: label } : undefined;
  if (key === "phone") return { id: key, type: "phone", labels };
  if (key === "email") return { id: key, type: "email", labels };
  return { id: key, type: "text", labels };
}

/**
 * `label: value` lines for the operator, in a stable order: the vertical's own
 * collected values first, then contact details.
 */
export function requestSummaryLines(opts: {
  request: RequestRow;
  lang: "en" | "he";
  /** Label overrides per field key, from UI copy and tenant config. */
  labels?: Record<string, string>;
  /** Values that should win over the stored row (e.g. a since-updated CRM name). */
  overrides?: Record<string, string | undefined>;
}): RequestSummaryLine[] {
  const { request, lang } = opts;
  const hidden = new Set(CAPABILITY_VIEW[request.capabilityId]?.hiddenKeys ?? []);
  const values: Record<string, string> = {};

  for (const [key, raw] of Object.entries(request.data)) {
    if (hidden.has(key)) continue;
    const value = String(raw ?? "").trim();
    if (value) values[key] = value;
  }
  const contact = {
    name: request.contactName,
    phone: request.contactPhone,
    email: request.contactEmail,
  };
  for (const [key, raw] of Object.entries(contact)) {
    const value = String(opts.overrides?.[key] ?? raw ?? "").trim();
    if (value) values[key] = value;
    else delete values[key];
  }
  for (const [key, raw] of Object.entries(opts.overrides ?? {})) {
    if (hidden.has(key) || key in contact) continue;
    const value = String(raw ?? "").trim();
    if (value) values[key] = value;
  }

  // Collected values first, contact last.
  const contactKeys = ["name", "phone", "email"];
  const orderedKeys = [
    ...Object.keys(values).filter((k) => !contactKeys.includes(k)),
    ...contactKeys.filter((k) => k in values),
  ];
  const specs = orderedKeys.map((key) => specFor(key, opts.labels?.[key]));

  return confirmLines(specs, values, {
    lang,
    labelFallback: opts.labels,
  }).map((line) => ({
    ...line,
    ltr: isLtrValue(line.value),
  }));
}

/** Phone numbers, emails and URLs must not reflow inside an RTL layout. */
function isLtrValue(value: string): boolean {
  return /^[+\d][\d\s()-]*$/.test(value) || value.includes("@") || /^https?:/.test(value);
}

/** Human-readable time for the operator: a span reads "start → end". */
export function requestTimeDisplay(request: RequestRow): string {
  return request.timeText.trim();
}
