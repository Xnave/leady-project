import { generateObject } from "ai";
import { z } from "zod";
import { chatModel, llmConfigured } from "@/lib/flow/model";
import { monthsIn } from "./validate";

export type DocExtraction = {
  docType: string;
  fields: Record<string, string>;
  /**
   * Set when the file was not shown to the model. An empty docType without this
   * means the model ran and the file matched none of the open types.
   */
  unread?: "no_model" | "extract_failed";
  error?: string;
  /** Compact summary for logs / LeadDocument.validation. */
  summary?: ExtractSummary;
};

export type ExtractSummary = {
  openTypes: string[];
  askedFields: string[];
  filledFields: string[];
  emptyFields: string[];
  finishReason?: string;
  warnings?: string[];
  evidence?: string;
  ms: number;
  bytes: number;
};

function fieldKeys(fields: Record<string, string>): { filled: string[]; empty: string[] } {
  const filled: string[] = [];
  const empty: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (String(value ?? "").trim()) filled.push(key);
    else empty.push(key);
  }
  return { filled, empty };
}

function askedForType(
  open: { docType: string; fields: string[] }[],
  docType: string,
): string[] {
  return open.find((item) => item.docType === docType)?.fields ?? [];
}

function warnExtract(fields: Record<string, unknown>): void {
  console.warn(JSON.stringify(fields));
}

function extractDetail(opts: {
  outcome: string;
  docType: string;
  openTypes: string[];
  filled: string[];
  empty: string[];
  inOpen: boolean;
  reason?: string;
  error?: string;
}): string {
  if (opts.outcome === "no_open_slots") return "No open document slots; file was not read.";
  if (opts.outcome === "skipped") return `Skipped vision (${opts.reason ?? "unknown"}).`;
  if (opts.outcome === "failed") return `Vision failed: ${opts.error ?? "unknown error"}.`;
  if (!opts.docType || opts.docType === "(none)") {
    return `Model did not match any open type (${opts.openTypes.join(", ") || "none"}).`;
  }
  if (!opts.inOpen) {
    return `Model saw "${opts.docType}", but open slots are only: ${opts.openTypes.join(", ") || "none"}.`;
  }
  if (opts.filled.length === 0 && opts.empty.length > 0) {
    return `Matched "${opts.docType}" but left fields empty: ${opts.empty.join(", ")}.`;
  }
  if (opts.empty.length) {
    return `Matched "${opts.docType}"; filled ${opts.filled.join(", ") || "(none)"}; empty ${opts.empty.join(", ")}.`;
  }
  return `Matched "${opts.docType}" with fields: ${opts.filled.join(", ") || "(none)"}.`;
}

function needsMonths(open: { fields: string[] }[]): boolean {
  return open.some((item) => item.fields.includes("months"));
}

const IDENTITY_FIELDS = ["nationalId", "firstName", "lastName"] as const;

function needsIdentity(open: { fields: string[] }[]): boolean {
  return open.some((item) => item.fields.some((field) => (IDENTITY_FIELDS as readonly string[]).includes(field)));
}

function needsPerson(open: { fields: string[] }[]): boolean {
  return open.some((item) => item.fields.includes("fullName"));
}

function needsPeriod(open: { fields: string[] }[]): boolean {
  return open.some((item) => item.fields.includes("periodEnd"));
}

function needsYear(open: { fields: string[] }[]): boolean {
  return open.some((item) => item.fields.includes("year"));
}

/** The tax year printed on a document, as YYYY. A labeled year wins over a signature date. */
export function yearFromText(value: unknown): string {
  const text = String(value ?? "");
  const labeled = text.match(/שנת\s*ה?מס[^\d]{0,16}(20\d{2})/i) ?? text.match(/tax year[^\d]{0,16}(20\d{2})/i);
  if (labeled) return labeled[1];
  return text.match(/20\d{2}/)?.[0] ?? "";
}

const PAY_MONTHS: { names: string[]; month: string }[] = [
  { names: ["ינואר", "january", "jan"], month: "01" },
  { names: ["פברואר", "פבואר", "february", "feb"], month: "02" },
  { names: ["מרץ", "מרס", "march", "mar"], month: "03" },
  { names: ["אפריל", "april", "apr"], month: "04" },
  { names: ["מאי", "may"], month: "05" },
  { names: ["יוני", "june", "jun"], month: "06" },
  { names: ["יולי", "july", "jul"], month: "07" },
  { names: ["אוגוסט", "august", "aug"], month: "08" },
  { names: ["ספטמבר", "september", "sep"], month: "09" },
  { names: ["אוקטובר", "october", "oct"], month: "10" },
  { names: ["נובמבר", "november", "nov"], month: "11" },
  { names: ["דצמבר", "december", "dec"], month: "12" },
];

/** Every payslip month named in a quote or a model field, as YYYY-MM. */
export function periodsFromText(value: unknown): string[] {
  const text = Array.isArray(value) ? value.map((item) => String(item ?? "")).join(" ") : String(value ?? "");
  const found: string[] = [];
  for (const match of text.matchAll(/(20\d{2})-(\d{2})/g)) found.push(`${match[1]}-${match[2]}`);
  for (const match of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/g)) {
    found.push(`${match[3]}-${match[2].padStart(2, "0")}`);
  }
  for (const item of PAY_MONTHS) {
    for (const name of item.names) {
      const re = /[a-z]/i.test(name)
        ? new RegExp(`\\b${name}\\s*['׳]?\\s*(20\\d{2}|\\d{2})\\b`, "gi")
        : new RegExp(`${name}\\s*['׳]?\\s*(20\\d{2}|\\d{2})`, "gi");
      for (const match of text.matchAll(re)) {
        const year = match[1].length === 2 ? `20${match[1]}` : match[1];
        found.push(`${year}-${item.month}`);
      }
    }
  }
  return [...new Set(found)].sort();
}

/** One payslip date as YYYY-MM-DD. A named month becomes the 15th. */
export function periodFromText(value: unknown): string {
  const text = String(value ?? "");
  const day = text.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if (day) return `${day[3]}-${day[2].padStart(2, "0")}-${day[1].padStart(2, "0")}`;
  const iso = text.match(/(20\d{2})-(\d{2})(?:-(\d{2}))?/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3] ?? "15"}`;
  const month = periodsFromText(text)[0];
  return month ? `${month}-15` : "";
}

/** Join a printed Israeli ID such as `2 0570771 4` into its digits. */
export function normalizeNationalId(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** A yes/no answer from the reader. Empty when it did not say. */
export function normalizeYesNo(value: unknown): "yes" | "no" | "" {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "";
  if (/^(yes|true|1)$/.test(text) || text === "כן") return "yes";
  if (/^(no|false|0)$/.test(text) || /^לא/.test(text)) return "no";
  return "";
}

/** `yes` when the card is biometric, `no` when it is the older paper card. */
export function normalizeBiometric(value: unknown): "yes" | "no" | "" {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "";
  if (/^לא/.test(text) || /^(no|false|0|paper)$/.test(text) || /not biometric/.test(text)) return "no";
  if (/^(yes|true|1|biometric)$/.test(text) || /ביומטר/.test(text)) return "yes";
  return "";
}

/** שם פרטי and שם משפחה are separate lines. Keep whichever parts were read. */
export function joinPersonName(fields: Record<string, string>): string {
  const full = fields.fullName?.trim() ?? "";
  if (full) return full;
  return [fields.firstName, fields.lastName].map((part) => part?.trim() ?? "").filter(Boolean).join(" ");
}

/** Flatten model field values (string or string[]) into plain strings. */
function flattenFields(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      out[key] = value.map((item) => String(item ?? "").trim()).filter(Boolean).join(", ");
    } else if (value != null) {
      out[key] = String(value).trim();
    }
  }
  return out;
}

/**
 * Normalize a months field into sorted unique YYYY-MM values.
 * Accepts comma lists, arrays already joined, and expands YYYY-MM..YYYY-MM ranges when both ends appear.
 */
export function normalizeMonthsField(value: unknown): string {
  const text = Array.isArray(value)
    ? value.map((item) => String(item ?? "")).join(",")
    : String(value ?? "");
  const found = monthsIn(text);
  // Expand a simple first..last range when the model only returned endpoints.
  const range = text.match(/(\d{4}-\d{2}).{1,12}(\d{4}-\d{2})/);
  if (range) {
    const [startY, startM] = range[1].split("-").map(Number);
    const [endY, endM] = range[2].split("-").map(Number);
    const start = startY * 12 + (startM - 1);
    const end = endY * 12 + (endM - 1);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start < 36) {
      for (let cursor = start; cursor <= end; cursor += 1) {
        const year = Math.floor(cursor / 12);
        const month = (cursor % 12) + 1;
        found.push(`${year}-${String(month).padStart(2, "0")}`);
      }
    }
  }
  return [...new Set(found)].sort().join(", ");
}

function extractSchema(opts: { months: boolean; identity: boolean; person: boolean; period: boolean; year: boolean }) {
  // Top-level fields: Gemini often leaves a generic fields{} record empty.
  const shape: Record<string, z.ZodType> = {
    docType: z.string(),
    fields: z.record(z.string(), z.string()).default({}),
  };
  if (opts.months) {
    shape.months = z
      .array(z.string())
      .describe("Every YYYY-MM calendar month the statement covers. Expand from-to ranges. Never empty when dates are visible.");
  }
  if (opts.identity) {
    shape.nationalId = z
      .string()
      .describe("9-digit Israeli ID. The card prints groups such as \"2 0570771 4\". Return the digits joined, with no spaces. Empty only when no number is visible.");
    shape.firstName = z.string().describe("שם פרטי, the given name on its own line. Empty when that line is not visible.");
    shape.lastName = z.string().describe("שם משפחה, the family name on its own line. Empty when that line is not visible.");
    shape.biometric = z
      .string()
      .describe("yes when this is a biometric plastic Israeli ID card (ביומטרי). no when it is the older paper card. Empty when the card type is not visible.");
    shape.appendix = z
      .string()
      .describe("yes when the ספח (the household appendix page) is visible in this same photo, even if it fills most of the frame. no when only the card is visible.");
  }
  if (opts.person) {
    shape.fullName = z
      .string()
      .describe("The person's full name printed on the document. Empty only when no name is visible.");
  }
  if (opts.period) {
    shape.periodEnd = z
      .string()
      .describe("One payslip's period end as YYYY-MM-DD. A Hebrew month counts: ינואר 2023 is 2023-01-31. Empty only when no month is visible.");
    shape.payMonths = z
      .array(z.string())
      .describe("Every payslip month in this file as YYYY-MM. Three slips means three months. Empty only when no month is visible.");
  }
  if (opts.year) {
    shape.year = z
      .string()
      .describe("The tax year this document is for, as YYYY. שנת מס 2025 is 2025. Do not use the date the letter was printed when it differs. Empty only when no tax year is visible.");
  }
  shape.evidence = z
    .string()
    .describe(
      opts.identity
        ? "Quote the printed ID-number groups and the name lines. Include the statement period when one is visible."
        : "Short quote of the period or header text that was read.",
    );
  return z.object(shape);
}

/**
 * Vision step: name the document and pull the fields the rules will check.
 * Pass/fail stays in the rules engine.
 */
type OpenDoc = { docType: string; label: string; fields: string[]; recognize?: string };

function catalogText(open: OpenDoc[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of open) {
    if (seen.has(item.docType)) continue;
    seen.add(item.docType);
    const how = item.recognize ? `${item.recognize} ` : "";
    lines.push(`${item.docType} (${item.label}): ${how}Fields: ${item.fields.join(", ") || "none"}.`);
  }
  return lines.join("\n");
}

function extractPrompt(open: OpenDoc[], asked: boolean): string {
  const lead = asked
    ? [
        `The customer just sent this file because they were asked for ${open[0]?.label ?? "a document"} (${open[0]?.docType ?? ""}).`,
        "A photo of that document counts the same as a scan, including a tilted, cropped, or partial photo of a plastic card.",
        `Set docType to ${open[0]?.docType ?? ""} when the file shows it. Use an empty docType only when it is clearly a different document.`,
      ].join(" ")
    : [
        "Identify this file as one of the open document types.",
        "A photograph of a document counts the same as a scan.",
        "Use an empty docType only when the file is clearly none of them.",
      ].join(" ");
  const identity = needsIdentity(open)
    ? [
        "On an Israeli ID card the number is printed in groups, for example \"2 0570771 4\". Put every digit in nationalId and leave no spaces. Quote those printed groups in evidence.",
        "The given name (שם פרטי) is firstName and the family name (שם משפחה) is lastName. They are separate lines. Fill whichever line is readable.",
        "When the photo also shows the large appendix (ספח), the number and the names are on the smaller identity card, not on the appendix.",
        "biometric is yes for a biometric plastic card and no for the older paper card.",
        "appendix is yes when that ספח page is in the same photo, and no when the photo shows only the card.",
      ].join(" ")
    : "";
  const year = needsYear(open)
    ? "year is the tax year the document covers, as YYYY. שנת מס 2025 is 2025. Quote that line in evidence."
    : "";
  return [lead, identity, year, "Extract the listed fields. Dates as YYYY-MM-DD when a full day is visible.", catalogText(open)]
    .filter(Boolean)
    .join("\n");
}

export async function extractDocument(opts: {
  bytes: Buffer;
  mime: string;
  filename: string;
  open: OpenDoc[];
  /** The document just requested. A no-match read is tried again against this type only. */
  focus?: string;
}): Promise<DocExtraction> {
  const openTypes = opts.open.map((item) => item.docType);
  const includeMonths = needsMonths(opts.open);
  const includeIdentity = needsIdentity(opts.open);
  const includePerson = needsPerson(opts.open);
  const includePeriod = needsPeriod(opts.open);
  const includeYear = needsYear(opts.open);
  const baseLog = {
    msg: "documents.extract",
    filename: opts.filename,
    mime: opts.mime,
    bytes: opts.bytes.length,
    openTypes,
  };

  if (!opts.open.length) {
    warnExtract({
      ...baseLog,
      outcome: "no_open_slots",
      detail: extractDetail({ outcome: "no_open_slots", docType: "", openTypes: [], filled: [], empty: [], inOpen: false }),
    });
    return { docType: "", fields: {}, summary: {
      openTypes: [],
      askedFields: [],
      filledFields: [],
      emptyFields: [],
      ms: 0,
      bytes: opts.bytes.length,
    } };
  }
  if (!llmConfigured()) {
    warnExtract({
      ...baseLog,
      outcome: "skipped",
      reason: "no_model",
      detail: extractDetail({
        outcome: "skipped",
        docType: "",
        openTypes,
        filled: [],
        empty: [],
        inOpen: false,
        reason: "no_model",
      }),
    });
    return {
      docType: "",
      fields: {},
      unread: "no_model",
      summary: {
        openTypes,
        askedFields: [],
        filledFields: [],
        emptyFields: [],
        ms: 0,
        bytes: opts.bytes.length,
      },
    };
  }

  const started = Date.now();
  try {
    const asked = Boolean(opts.focus && opts.open.every((item) => item.docType === opts.focus));
    const result = await generateObject({
      model: chatModel(),
      schema: extractSchema({
        months: includeMonths,
        identity: includeIdentity,
        person: includePerson,
        period: includePeriod,
        year: includeYear,
      }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                extractPrompt(opts.open, asked),
                includeMonths
                  ? [
                      "If this is a bank statement (תדפיס עו״ש / דפי בנק), months is required whenever any period or transaction dates are visible.",
                      "Read the statement period header (from-to). Expand that range into EVERY calendar month YYYY-MM between the ends, inclusive.",
                      "Also include months clearly shown by transaction dates. Return months as an array of YYYY-MM strings.",
                      "Do not leave months empty when dates are readable. Put a short quote of the period text in evidence.",
                    ].join(" ")
                  : "",
                includePeriod
                  ? [
                      "This file may be one payslip or several payslips together.",
                      "fullName is the employee name. periodEnd is one payslip month as YYYY-MM-DD. ינואר 2023 is 2023-01-31.",
                      "payMonths lists every payslip month in the file as YYYY-MM. Three slips means three months.",
                      "Do not leave the name or the months empty when they are visible. Quote the name and the months in evidence.",
                    ].join(" ")
                  : "Leave unknown fields empty.",
              ].filter(Boolean).join("\n"),
            },
            {
              type: "file",
              data: opts.bytes,
              filename: opts.filename,
              mediaType: opts.mime || "application/octet-stream",
            },
          ],
        },
      ],
    });
    const ms = Date.now() - started;
    const allowed = new Set(opts.open.map((item) => item.docType));
    const docType = result.object.docType.trim();
    const inOpen = Boolean(docType && allowed.has(docType));
    const raw = result.object as {
      fields?: Record<string, unknown>;
      months?: unknown;
      nationalId?: unknown;
      firstName?: unknown;
      lastName?: unknown;
      fullName?: unknown;
      biometric?: unknown;
      appendix?: unknown;
      periodEnd?: unknown;
      payMonths?: unknown;
      year?: unknown;
    };
    const fields = flattenFields(raw.fields ?? {});
    for (const key of IDENTITY_FIELDS) {
      const top = typeof raw[key] === "string" ? raw[key].trim() : "";
      if (top) fields[key] = top;
    }
    if (fields.nationalId) fields.nationalId = normalizeNationalId(fields.nationalId);
    const biometric = normalizeBiometric(raw.biometric ?? fields.biometric);
    if (biometric) fields.biometric = biometric;
    const appendix = normalizeYesNo(raw.appendix ?? fields.appendix);
    if (appendix) fields.appendix = appendix;
    if (typeof raw.fullName === "string" && raw.fullName.trim()) fields.fullName = raw.fullName.trim();
    const name = joinPersonName(fields);
    if (name) fields.fullName = name;
    if (includeMonths && "months" in result.object) {
      const months = normalizeMonthsField(
        (result.object as { months?: unknown }).months ?? fields.months,
      );
      if (months) fields.months = months;
    } else if (fields.months) {
      fields.months = normalizeMonthsField(fields.months);
    }
    const evidence =
      "evidence" in result.object && typeof result.object.evidence === "string"
        ? result.object.evidence.trim()
        : "";
    const asksYear = inOpen && askedForType(opts.open, docType).includes("year");
    if (asksYear) {
      const explicit = yearFromText(raw.year ?? fields.year);
      const quoted = yearFromText(evidence);
      if (explicit) fields.year = explicit;
      else if (quoted) fields.year = quoted;
    }
    if (includePeriod && docType === "payslip") {
      const listed = [
        ...periodsFromText(raw.payMonths),
        ...periodsFromText(fields.payMonths),
        ...periodsFromText(raw.periodEnd ?? fields.periodEnd),
        ...periodsFromText(evidence),
      ];
      const payMonths = [...new Set(listed)].sort();
      if (payMonths.length) fields.payMonths = payMonths.join(", ");
      const explicit = periodFromText(raw.periodEnd ?? fields.periodEnd);
      const latest = payMonths.at(-1);
      if (explicit) fields.periodEnd = explicit;
      else if (latest) fields.periodEnd = `${latest}-15`;
    }
    const { filled, empty } = fieldKeys(fields);
    const askedFields = inOpen ? askedForType(opts.open, docType) : [];
    const missingAsked = askedFields.filter((field) => !(field in fields) || !String(fields[field] ?? "").trim());
    const emptyFields = inOpen ? [...new Set([...empty, ...missingAsked])] : empty;
    const warnings = (result.warnings ?? [])
      .map((warning) => ("message" in warning ? String(warning.message) : JSON.stringify(warning)))
      .filter(Boolean);
    const summary: ExtractSummary = {
      openTypes,
      askedFields,
      filledFields: filled,
      emptyFields,
      finishReason: result.finishReason,
      ...(warnings.length ? { warnings } : {}),
      ...(evidence ? { evidence } : {}),
      ms,
      bytes: opts.bytes.length,
    };
    const sparse = Boolean(inOpen && askedFields.length && filled.length === 0);
    warnExtract({
      ...baseLog,
      outcome: "ok",
      docType: docType || "(none)",
      inOpen,
      askedFields,
      filledFields: filled,
      emptyFields,
      ...(fields.months ? { months: fields.months } : {}),
      ...(evidence ? { evidence } : {}),
      finishReason: result.finishReason,
      ...(warnings.length ? { warnings } : {}),
      ms,
      sparse,
      detail: extractDetail({
        outcome: "ok",
        docType: docType || "(none)",
        openTypes,
        filled,
        empty: emptyFields,
        inOpen,
      }),
    });
    const focused = opts.open.filter((item) => item.docType === opts.focus);
    const idNumberMissing = opts.focus === "id_card" && docType === "id_card" && !fields.nationalId;
    if ((!docType || idNumberMissing) && opts.focus && focused.length && focused.length < opts.open.length) {
      return extractDocument({ ...opts, open: focused });
    }
    return { docType, fields, summary };
  } catch (err) {
    const ms = Date.now() - started;
    const error = err instanceof Error ? err.message : String(err);
    warnExtract({
      ...baseLog,
      outcome: "failed",
      error,
      ms,
      detail: extractDetail({
        outcome: "failed",
        docType: "",
        openTypes,
        filled: [],
        empty: [],
        inOpen: false,
        error,
      }),
    });
    return {
      docType: "",
      fields: {},
      unread: "extract_failed",
      error,
      summary: {
        openTypes,
        askedFields: [],
        filledFields: [],
        emptyFields: [],
        ms,
        bytes: opts.bytes.length,
      },
    };
  }
}
