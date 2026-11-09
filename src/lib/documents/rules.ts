/**
 * Checklist rules. A profile (from SmartNPV) plus this JSON decides which
 * document slots a lead must send. New documents and conditions are data.
 * A new comparison is a check op added here.
 */

export type Profile = Record<string, unknown>;

export type Condition =
  | { op: "all"; of: Condition[] }
  | { op: "any"; of: Condition[] }
  | { op: "eq"; key: string; value: string | number | boolean }
  | { op: "neq"; key: string; value: string | number | boolean }
  | { op: "gt"; key: string; value: number }
  | { op: "truthy"; key: string };

export type Check =
  | { op: "field_present"; field: string }
  | { op: "matches_profile"; field: string; profileKey: string }
  | { op: "date_within_months"; field: string; months: number }
  | { op: "prior_calendar_months"; field: string; months: number }
  | { op: "min_items"; field: string; count: number };

/** A PDF we send once so the customer can fill it and send it back. */
export type BlankFormDef = {
  /** File name under `assets/blank-forms/`. */
  file: string;
  once: "conversation";
};

export type DocTypeDef = {
  labels: { he: string; en: string };
  /** How the reader recognizes this document, including a photo of it. */
  recognize?: string;
  /** Fields the extractor must pull before checks run. */
  fields: string[];
  checks: Check[];
  /** Present when this type starts by sending a blank form. */
  blankForm?: BlankFormDef;
};

export type StageDef = {
  id: string;
  labels: { he: string; en: string };
};

export type Requirement = {
  docType: string;
  stage: string;
  when?: Condition;
  /** How many accepted files of this type. Default 1. */
  count?: number;
  /** Read the file count from the profile instead of `count`. */
  countFrom?: "loanCount";
  /** Which collection wave this requirement belongs to. Default "1". */
  collectionStage?: string;
  /** Open the row once per borrower or once per known account. */
  each?: "borrower" | "account";
  /** When `each` is account and the file lists none, open one slot. */
  empty?: "one";
  /** Year taken from the rules document. */
  year?: "taxYear" | "accountantYear";
  /** Prior calendar months a statement must cover. */
  months?: number;
};

export type RulesDocument = {
  stages: StageDef[];
  /** Collection waves. Stage 1 is the identity, income, and banking list. */
  collectionStages?: StageDef[];
  requirements: Requirement[];
  documents: Record<string, DocTypeDef>;
  /** Label years for the self-employed list. Defaults live on the mortgage rules. */
  taxYear?: number;
  accountantYear?: number;
};

export type Slot = {
  id: string;
  docType: string;
  stage: string;
  index: number;
  /** Borrower slot (`1` or `2`) when the file belongs to one person. */
  borrower?: string;
  /** Bank account id when the file is that account's statement. */
  accountId?: string;
  /** Calendar year this file covers, when the same type is asked for two years. */
  year?: number;
  /** Slots that share a group are satisfied once any one of them is uploaded. */
  altGroup?: string;
  /** Collection wave. Missing means stage 1. */
  collectionStage?: string;
  /** YYYY-MM months a statement must cover. The current month is never included. */
  months?: string[];
};

export const CHECK_OPS = [
  "field_present",
  "matches_profile",
  "date_within_months",
  "prior_calendar_months",
  "min_items",
] as const;

export class RulesError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.name = "RulesError";
    this.errors = errors;
  }
}

function parseBlankForm(raw: unknown, path: string, errors: string[]): BlankFormDef | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const file = typeof raw.file === "string" ? raw.file.trim() : "";
  if (!file) errors.push(`${path}.file is required`);
  if (raw.once !== "conversation") errors.push(`${path}.once must be "conversation"`);
  if (!file || raw.once !== "conversation") return undefined;
  return { file, once: "conversation" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCondition(raw: unknown, path: string, errors: string[]): Condition | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || typeof raw.op !== "string") {
    errors.push(`${path} must be a condition`);
    return undefined;
  }
  if (raw.op === "all" || raw.op === "any") {
    if (!Array.isArray(raw.of)) {
      errors.push(`${path}.of must be a list`);
      return undefined;
    }
    const of = raw.of
      .map((item, i) => parseCondition(item, `${path}.of[${i}]`, errors))
      .filter((item): item is Condition => Boolean(item));
    return { op: raw.op, of };
  }
  if (raw.op === "truthy") {
    if (typeof raw.key !== "string" || !raw.key.trim()) errors.push(`${path}.key is required`);
    return { op: "truthy", key: String(raw.key ?? "") };
  }
  if (raw.op === "eq" || raw.op === "neq") {
    const value = raw.value;
    if (typeof raw.key !== "string" || !raw.key.trim()) errors.push(`${path}.key is required`);
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      errors.push(`${path}.value must be a string, number, or boolean`);
    }
    return {
      op: raw.op,
      key: String(raw.key ?? ""),
      value: (typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? value
        : "") as string | number | boolean,
    };
  }
  if (raw.op === "gt") {
    if (typeof raw.key !== "string" || !raw.key.trim()) errors.push(`${path}.key is required`);
    if (typeof raw.value !== "number") errors.push(`${path}.value must be a number`);
    return { op: "gt", key: String(raw.key ?? ""), value: typeof raw.value === "number" ? raw.value : 0 };
  }
  errors.push(`${path}.op "${raw.op}" is not a condition`);
  return undefined;
}

function parseCheck(raw: unknown, path: string, errors: string[]): Check | undefined {
  if (!isRecord(raw) || typeof raw.op !== "string") {
    errors.push(`${path} must be a check`);
    return undefined;
  }
  if (!CHECK_OPS.includes(raw.op as (typeof CHECK_OPS)[number])) {
    errors.push(`${path}.op "${raw.op}" is not a check`);
    return undefined;
  }
  if (raw.op === "field_present") {
    if (typeof raw.field !== "string" || !raw.field.trim()) errors.push(`${path}.field is required`);
    return { op: "field_present", field: String(raw.field ?? "") };
  }
  if (raw.op === "matches_profile") {
    if (typeof raw.field !== "string" || !raw.field.trim()) errors.push(`${path}.field is required`);
    if (typeof raw.profileKey !== "string" || !raw.profileKey.trim()) {
      errors.push(`${path}.profileKey is required`);
    }
    return {
      op: "matches_profile",
      field: String(raw.field ?? ""),
      profileKey: String(raw.profileKey ?? ""),
    };
  }
  if (raw.op === "date_within_months" || raw.op === "prior_calendar_months") {
    if (typeof raw.field !== "string" || !raw.field.trim()) errors.push(`${path}.field is required`);
    if (typeof raw.months !== "number" || raw.months < 1) errors.push(`${path}.months must be >= 1`);
    return {
      op: raw.op,
      field: String(raw.field ?? ""),
      months: typeof raw.months === "number" ? raw.months : 1,
    };
  }
  if (typeof raw.field !== "string" || !raw.field.trim()) errors.push(`${path}.field is required`);
  if (typeof raw.count !== "number" || raw.count < 1) errors.push(`${path}.count must be >= 1`);
  return {
    op: "min_items",
    field: String(raw.field ?? ""),
    count: typeof raw.count === "number" ? raw.count : 1,
  };
}

function parseLabels(raw: unknown, path: string, errors: string[]): { he: string; en: string } {
  const rec = isRecord(raw) ? raw : {};
  const he = typeof rec.he === "string" ? rec.he.trim() : "";
  const en = typeof rec.en === "string" ? rec.en.trim() : "";
  if (!he) errors.push(`${path}.he is required`);
  if (!en) errors.push(`${path}.en is required`);
  return { he, en };
}

/** Reject unknown ops, dangling doc types, and empty stages. */
export function parseRules(raw: unknown): RulesDocument {
  const errors: string[] = [];
  if (!isRecord(raw)) throw new RulesError(["rules must be an object"]);
  if (!Array.isArray(raw.stages) || raw.stages.length === 0) errors.push("stages must be a non-empty list");
  const stages: StageDef[] = [];
  const stageIds = new Set<string>();
  for (const [i, item] of (Array.isArray(raw.stages) ? raw.stages : []).entries()) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) {
      errors.push(`stages[${i}].id is required`);
      continue;
    }
    const id = item.id.trim();
    if (stageIds.has(id)) errors.push(`stages[${i}] duplicates "${id}"`);
    stageIds.add(id);
    stages.push({ id, labels: parseLabels(item.labels, `stages[${i}].labels`, errors) });
  }
  const collectionStages: StageDef[] = [];
  const collectionIds = new Set<string>();
  if (raw.collectionStages !== undefined) {
    if (!Array.isArray(raw.collectionStages) || raw.collectionStages.length === 0) {
      errors.push("collectionStages must be a list");
    }
    for (const [i, item] of (Array.isArray(raw.collectionStages) ? raw.collectionStages : []).entries()) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) {
        errors.push(`collectionStages[${i}].id is required`);
        continue;
      }
      const id = item.id.trim();
      if (collectionIds.has(id)) errors.push(`collectionStages[${i}] duplicates "${id}"`);
      collectionIds.add(id);
      collectionStages.push({ id, labels: parseLabels(item.labels, `collectionStages[${i}].labels`, errors) });
    }
  }
  const documents: Record<string, DocTypeDef> = {};
  if (!isRecord(raw.documents)) errors.push("documents must be an object");
  for (const [id, def] of Object.entries(isRecord(raw.documents) ? raw.documents : {})) {
    if (!isRecord(def)) {
      errors.push(`documents.${id} must be an object`);
      continue;
    }
    const fields = Array.isArray(def.fields)
      ? def.fields.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      : [];
    const checks = (Array.isArray(def.checks) ? def.checks : [])
      .map((check, i) => parseCheck(check, `documents.${id}.checks[${i}]`, errors))
      .filter((check): check is Check => Boolean(check));
    const blankForm = parseBlankForm(def.blankForm, `documents.${id}.blankForm`, errors);
    const recognize = typeof def.recognize === "string" ? def.recognize.trim() : "";
    documents[id] = {
      labels: parseLabels(def.labels, `documents.${id}.labels`, errors),
      fields,
      checks,
      ...(recognize ? { recognize } : {}),
      ...(blankForm ? { blankForm } : {}),
    };
  }
  const requirements: Requirement[] = [];
  if (!Array.isArray(raw.requirements)) errors.push("requirements must be a list");
  for (const [i, item] of (Array.isArray(raw.requirements) ? raw.requirements : []).entries()) {
    if (!isRecord(item)) {
      errors.push(`requirements[${i}] must be an object`);
      continue;
    }
    const docType = typeof item.docType === "string" ? item.docType.trim() : "";
    const stage = typeof item.stage === "string" ? item.stage.trim() : "";
    if (!docType || !documents[docType]) errors.push(`requirements[${i}].docType is not defined`);
    if (!stage || !stageIds.has(stage)) errors.push(`requirements[${i}].stage is not defined`);
    const count = item.count === undefined ? 1 : item.count;
    if (typeof count !== "number" || count < 1) errors.push(`requirements[${i}].count must be >= 1`);
    const collectionStage = typeof item.collectionStage === "string" ? item.collectionStage.trim() : "";
    if (collectionStage && collectionIds.size > 0 && !collectionIds.has(collectionStage)) {
      errors.push(`requirements[${i}].collectionStage is not defined`);
    }
    let each: Requirement["each"];
    if (item.each !== undefined) {
      if (item.each !== "borrower" && item.each !== "account") errors.push(`requirements[${i}].each is invalid`);
      else each = item.each;
    }
    let empty: Requirement["empty"];
    if (item.empty !== undefined) {
      if (item.empty !== "one") errors.push(`requirements[${i}].empty is invalid`);
      else empty = "one";
    }
    let year: Requirement["year"];
    if (item.year !== undefined) {
      if (item.year !== "taxYear" && item.year !== "accountantYear") errors.push(`requirements[${i}].year is invalid`);
      else year = item.year;
    }
    let months: number | undefined;
    if (item.months !== undefined) {
      if (typeof item.months !== "number" || item.months < 1) errors.push(`requirements[${i}].months must be >= 1`);
      else months = Math.floor(item.months);
    }
    let countFrom: Requirement["countFrom"];
    if (item.countFrom !== undefined) {
      if (item.countFrom !== "loanCount") errors.push(`requirements[${i}].countFrom is invalid`);
      else countFrom = "loanCount";
    }
    requirements.push({
      docType,
      stage,
      count: typeof count === "number" ? count : 1,
      when: parseCondition(item.when, `requirements[${i}].when`, errors),
      ...(collectionStage ? { collectionStage } : {}),
      ...(each ? { each } : {}),
      ...(empty ? { empty } : {}),
      ...(year ? { year } : {}),
      ...(months ? { months } : {}),
      ...(countFrom ? { countFrom } : {}),
    });
  }
  if (errors.length) throw new RulesError(errors);
  return {
    stages,
    ...(collectionStages.length ? { collectionStages } : {}),
    requirements,
    documents,
    ...(typeof raw.taxYear === "number" ? { taxYear: raw.taxYear } : {}),
    ...(typeof raw.accountantYear === "number" ? { accountantYear: raw.accountantYear } : {}),
  };
}

export function conditionMatches(condition: Condition | undefined, profile: Profile): boolean {
  if (!condition) return true;
  if (condition.op === "all") return condition.of.every((item) => conditionMatches(item, profile));
  if (condition.op === "any") return condition.of.some((item) => conditionMatches(item, profile));
  if (condition.op === "truthy") return Boolean(profile[condition.key]);
  if (condition.op === "eq") return profile[condition.key] === condition.value;
  if (condition.op === "neq") return profile[condition.key] !== condition.value;
  const current = profile[condition.key];
  return typeof current === "number" && current > condition.value;
}

/** Slots this profile still has to satisfy, in stage order. */
export function requiredSlots(profile: Profile, rules: RulesDocument): Slot[] {
  const stageOrder = new Map(rules.stages.map((stage, index) => [stage.id, index]));
  const slots: Slot[] = [];
  const ranked = [...rules.requirements].sort(
    (a, b) => (stageOrder.get(a.stage) ?? 0) - (stageOrder.get(b.stage) ?? 0),
  );
  for (const requirement of ranked) {
    if (!conditionMatches(requirement.when, profile)) continue;
    const count = requirement.count ?? 1;
    for (let index = 0; index < count; index += 1) {
      slots.push({
        id: `${requirement.docType}#${index}`,
        docType: requirement.docType,
        stage: requirement.stage,
        index,
        collectionStage: requirement.collectionStage ?? "1",
      });
    }
  }
  return slots;
}

export function docLabel(rules: RulesDocument, docType: string, lang: "en" | "he"): string {
  return rules.documents[docType]?.labels[lang] ?? rules.documents[docType]?.labels.en ?? docType;
}

export function stageLabel(rules: RulesDocument, stageId: string, lang: "en" | "he"): string {
  const stage = rules.stages.find((item) => item.id === stageId);
  return stage?.labels[lang] ?? stage?.labels.en ?? stageId;
}
