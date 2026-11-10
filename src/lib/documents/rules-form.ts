import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";
import {
  RulesError,
  parseRules,
  type Condition,
  type RulesDocument,
} from "@/lib/documents/rules";

export type RulesIssueText = {
  nameHeRequired: string;
  nameEnRequired: string;
  idRequired: string;
  idTaken: string;
  fieldRequired: string;
  checkUnknown: string;
  docMissing: string;
  stageMissing: string;
  countInvalid: string;
  condKeyRequired: string;
  condValueRequired: string;
  monthsInvalid: string;
  stagesRequired: string;
  collectionRequired: string;
  blankFileRequired: string;
};

export function rulesIssueList(rules: unknown): string[] {
  try {
    parseRules(rules);
    return [];
  } catch (err) {
    if (err instanceof RulesError) return err.errors;
    return [err instanceof Error ? err.message : "rules are invalid"];
  }
}

/** A document the form can edit. Invalid input falls back to the mortgage list. */
export function loadRulesDocument(raw: unknown): RulesDocument {
  try {
    const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    return parseRules(value ?? MORTGAGE_RULES);
  } catch {
    return parseRules(MORTGAGE_RULES);
  }
}

export function explainRulesIssue(issue: string, text: RulesIssueText): string {
  const dup = issue.match(/duplicates "([^"]+)"/);
  if (dup) return text.idTaken.replace("{id}", dup[1] ?? "");
  if (issue.includes("labels.he is required")) return text.nameHeRequired;
  if (issue.includes("labels.en is required")) return text.nameEnRequired;
  if (issue.endsWith(".id is required") || issue.includes(".id is required")) return text.idRequired;
  if (issue.includes(".field is required")) return text.fieldRequired;
  if (issue.includes("is not a check")) return text.checkUnknown;
  if (issue.includes("docType is not defined")) return text.docMissing;
  if (issue.includes(".stage is not defined") || issue.includes("stage is not defined")) return text.stageMissing;
  if (issue.includes("count must be")) return text.countInvalid;
  if (issue.includes(".key is required")) return text.condKeyRequired;
  if (issue.includes(".value must be")) return text.condValueRequired;
  if (issue.includes("months must be")) return text.monthsInvalid;
  if (issue === "stages must be a non-empty list") return text.stagesRequired;
  if (issue === "collectionStages must be a list") return text.collectionRequired;
  if (issue.includes("blankForm") && issue.includes("file is required")) return text.blankFileRequired;
  return issue;
}

export function uniqueId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  let id = `${prefix}_${n}`;
  while (used.has(id)) id = `${prefix}_${++n}`;
  return id;
}

export function nextNumericId(taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(String(n))) n += 1;
  return String(n);
}

export function moveBy<T>(items: readonly T[], index: number, dir: -1 | 1): T[] {
  const next = index + dir;
  if (next < 0 || next >= items.length) return [...items];
  const copy = [...items];
  const [item] = copy.splice(index, 1);
  if (item === undefined) return [...items];
  copy.splice(next, 0, item);
  return copy;
}

export function conditionShape(when: Condition | undefined): "always" | "flat" | "nested" {
  if (!when) return "always";
  if (when.op !== "all" && when.op !== "any") return "flat";
  if (when.of.every((item) => item.op !== "all" && item.op !== "any")) return "flat";
  return "nested";
}

export function renameDocument(rules: RulesDocument, from: string, to: string): RulesDocument | null {
  const nextId = to.trim();
  if (!nextId || nextId === from) return rules;
  if (rules.documents[nextId]) return null;
  const documents: RulesDocument["documents"] = {};
  for (const [id, def] of Object.entries(rules.documents)) {
    documents[id === from ? nextId : id] = def;
  }
  return {
    ...rules,
    documents,
    requirements: rules.requirements.map((req) => (req.docType === from ? { ...req, docType: nextId } : req)),
  };
}

export function renameStage(rules: RulesDocument, from: string, to: string): RulesDocument | null {
  const nextId = to.trim();
  if (!nextId || nextId === from) return rules;
  if (rules.stages.some((stage) => stage.id === nextId)) return null;
  return {
    ...rules,
    stages: rules.stages.map((stage) => (stage.id === from ? { ...stage, id: nextId } : stage)),
    requirements: rules.requirements.map((req) => (req.stage === from ? { ...req, stage: nextId } : req)),
  };
}

export function renameWave(rules: RulesDocument, from: string, to: string): RulesDocument | null {
  const nextId = to.trim();
  if (!nextId || nextId === from) return rules;
  const waves = rules.collectionStages ?? [];
  if (waves.some((stage) => stage.id === nextId)) return null;
  return {
    ...rules,
    collectionStages: waves.map((stage) => (stage.id === from ? { ...stage, id: nextId } : stage)),
    requirements: rules.requirements.map((req) =>
      req.collectionStage === from ? { ...req, collectionStage: nextId } : req,
    ),
  };
}
