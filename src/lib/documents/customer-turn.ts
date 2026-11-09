import { generateObject } from "ai";
import { z } from "zod";
import { chatModel, llmConfigured } from "@/lib/flow/model";
import {
  affirmsExistingLoans,
  applyFactIntents,
  asksHowToGet,
  declinesExistingLoans,
  missingTheDocument,
  retractsLastFile,
  type Employment,
  type FactRevision,
} from "./facts";
import type { Profile } from "./rules";

/** Below this, the whole proposal waits for a yes. */
export const INTENT_CONFIDENCE = 0.8;

export type FactName =
  | "loans"
  | "employment"
  | "second_borrower"
  | "first_home"
  | "couple_split"
  | "salary_deposit"
  | "more_loans";

export type CustomerIntent =
  | { kind: "fact"; fact: FactName; value: string; confidence: number }
  | { kind: "retract"; target: "id_card_back" | "latest"; confidence: number }
  | { kind: "how_to"; detail: "short" | "steps"; confidence: number }
  | { kind: "answer"; value: "yes" | "no"; confidence: number };

/** What the reader needs. The checklist itself stays on the profile. */
export type FactSnapshot = {
  loans: "known" | "none" | "unknown";
  employment: Employment;
  employmentSource: string;
  secondBorrower: "yes" | "no" | "unknown";
  firstHome: "true" | "false" | "unknown";
  coupleSplit: "yes" | "no" | "unknown";
  salaryDeposit: "yes" | "no" | "";
  loanMore: string;
  openQuestion: string;
  documentOpen: boolean;
};

export type CustomerTurnRead = { intents: CustomerIntent[]; source: "model" | "fallback" };

const FACTS: FactName[] = [
  "loans",
  "employment",
  "second_borrower",
  "first_home",
  "couple_split",
  "salary_deposit",
  "more_loans",
];

const EMPLOYMENT_VALUES = new Set(["salaried", "self_employed", "controlling_shareholder", "both", "other"]);

function clampConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

/** Drop anything the model invented outside the closed list. */
export function normalizeIntents(raw: unknown): CustomerIntent[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { intents?: unknown }).intents)
      ? (raw as { intents: unknown[] }).intents
      : [];
  const intents: CustomerIntent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const confidence = clampConfidence(row.confidence);
    if (row.kind === "retract") {
      intents.push({
        kind: "retract",
        target: row.target === "id_card_back" ? "id_card_back" : "latest",
        confidence,
      });
      continue;
    }
    if (row.kind === "how_to") {
      intents.push({ kind: "how_to", detail: row.detail === "short" ? "short" : "steps", confidence });
      continue;
    }
    if (row.kind === "answer" && (row.value === "yes" || row.value === "no")) {
      intents.push({ kind: "answer", value: row.value, confidence });
      continue;
    }
    if (row.kind !== "fact" || typeof row.fact !== "string" || !FACTS.includes(row.fact as FactName)) continue;
    const fact = row.fact as FactName;
    const value = typeof row.value === "string" ? row.value.trim() : "";
    if (!validFactValue(fact, value)) continue;
    intents.push({ kind: "fact", fact, value, confidence });
  }
  return intents;
}

function validFactValue(fact: FactName, value: string): boolean {
  if (fact === "loans") return value === "known" || value === "none";
  if (fact === "employment") return EMPLOYMENT_VALUES.has(value);
  if (fact === "second_borrower" || fact === "couple_split" || fact === "salary_deposit" || fact === "more_loans") {
    return value === "yes" || value === "no";
  }
  return value === "true" || value === "false";
}

/** A question or a filler, not a request to change the file. How-to questions are handled first. */
export function isIdleQuestion(text: string): boolean {
  if (asksHowToGet(text)) return false;
  const value = text.trim();
  return /[?？]/.test(value)
    || /^(אם|האם|אפשר|can i|could i|what if)\b/i.test(value)
    || /זה משנה|does it matter/i.test(value);
}

function employmentStatement(text: string): Employment | null {
  const folded = text.toLowerCase();
  let employment: Employment | null = null;
  if (/שכיר וגם עצמאי|עצמאי וגם שכיר|גם וגם|שכיר ועצמאי|salaried and self|\bboth\b/.test(folded)) employment = "both";
  else if (/בעל שליטה|controlling shareholder/.test(folded)) employment = "controlling_shareholder";
  else if (/(?:^|[\s,.])אחר(?:$|[\s,.!?])|\bother\b/.test(folded)) employment = "other";
  else if (/עצמאי|self[-\s]?employed/.test(folded)) employment = "self_employed";
  else if (/שכיר|\bsalaried\b/.test(folded)) employment = "salaried";
  if (!employment) return null;
  if (/בעצם|התכוונתי|טעיתי|actually|i meant|אני\s/i.test(text)) return employment;
  if (/^(שכיר|עצמאי|בעל שליטה|גם וגם)/.test(text.trim())) return employment;
  return null;
}

function factFromText(text: string): CustomerIntent | null {
  const confidence = 0.95;
  const employment = employmentStatement(text);
  if (employment) return { kind: "fact", fact: "employment", value: employment, confidence };
  if (/הלוואה נוספת|הלוואות נוספות|עוד הלוואה|another loan|more loans/i.test(text)) {
    const value = /אין|no more|no other/i.test(text) ? "no" : "yes";
    return { kind: "fact", fact: "more_loans", value, confidence };
  }
  if (declinesExistingLoans(text)) return { kind: "fact", fact: "loans", value: "none", confidence };
  if (affirmsExistingLoans(text)) return { kind: "fact", fact: "loans", value: "known", confidence };
  if (/אין לווה|אין עוד לווה|רק אני|only me|no other borrower|no second borrower/i.test(text)) {
    return { kind: "fact", fact: "second_borrower", value: "no", confidence };
  }
  if (/לווה נוסף|עוד לווה|שני לווים|second borrower|another borrower/i.test(text)) {
    return { kind: "fact", fact: "second_borrower", value: "yes", confidence };
  }
  if (/דירה ה?ראשונה|first home/i.test(text)) {
    const value = /לא דירה|זו לא|זה לא|not (?:a |our )?first/i.test(text) ? "false" : "true";
    if (value === "true" && !/בעצם|התכוונתי|זו דירה|זאת דירה|it is/i.test(text)) return null;
    return { kind: "fact", fact: "first_home", value, confidence };
  }
  if (/אישה שכיר|wife is salaried|husband is self/i.test(text)) {
    return { kind: "fact", fact: "couple_split", value: "yes", confidence };
  }
  if (/האישה לא|wife is not|הבעל לא עצמאי/i.test(text)) {
    return { kind: "fact", fact: "couple_split", value: "no", confidence };
  }
  if (/לא מופקד|לא מפקיד|not deposited|does not deposit/i.test(text)) {
    return { kind: "fact", fact: "salary_deposit", value: "no", confidence };
  }
  if (/מופקד לחשבון|deposited into/i.test(text)) {
    return { kind: "fact", fact: "salary_deposit", value: "yes", confidence };
  }
  return null;
}

/**
 * Keyword read used only when no model is configured or the call throws.
 * A successful model read that returns an empty list does not come through here.
 */
export function fallbackIntents(message: string, snapshot: FactSnapshot): CustomerIntent[] {
  const text = message.trim();
  if (!text) return [];
  if (asksHowToGet(text)) return [{ kind: "how_to", detail: "steps", confidence: 0.95 }];
  if (missingTheDocument(text)) {
    if (snapshot.openQuestion === "loans" && snapshot.loans === "unknown") {
      return [{ kind: "fact", fact: "loans", value: "none", confidence: 0.95 }];
    }
    if (snapshot.documentOpen) return [{ kind: "how_to", detail: "short", confidence: 0.95 }];
    return [];
  }
  if (isIdleQuestion(text)) return [];
  const intents: CustomerIntent[] = [];
  if (retractsLastFile(text)) {
    const target = /רישיון|צד (ה)?שני|licen[cs]e|back of the/i.test(text) ? "id_card_back" : "latest";
    intents.push({ kind: "retract", target, confidence: 0.95 });
  }
  const fact = factFromText(text);
  if (fact) intents.push(fact);
  if (/^(כן|yes)[.!?\s]*$/i.test(text)) intents.push({ kind: "answer", value: "yes", confidence: 0.95 });
  if (/^(לא|no)[.!?\s]*$/i.test(text)) intents.push({ kind: "answer", value: "no", confidence: 0.95 });
  return intents;
}

function knownDiffers(current: string, value: string): boolean {
  return current !== "unknown" && current !== "" && current !== value;
}

/** A retract, or a fact that would replace an answer already stored. */
export function changesStoredFact(snapshot: FactSnapshot, intent: CustomerIntent): boolean {
  if (intent.kind === "retract") return true;
  if (intent.kind !== "fact") return false;
  if (intent.fact === "loans") return knownDiffers(snapshot.loans, intent.value);
  if (intent.fact === "employment") return knownDiffers(snapshot.employment, intent.value);
  if (intent.fact === "second_borrower") return knownDiffers(snapshot.secondBorrower, intent.value);
  if (intent.fact === "first_home") return knownDiffers(snapshot.firstHome, intent.value);
  if (intent.fact === "couple_split") return knownDiffers(snapshot.coupleSplit, intent.value);
  if (intent.fact === "salary_deposit") return snapshot.salaryDeposit === "yes" || snapshot.salaryDeposit === "no"
    ? snapshot.salaryDeposit !== intent.value
    : false;
  if (intent.fact === "more_loans") return snapshot.loanMore === "no" && intent.value === "yes";
  return false;
}

/** Hold the whole list when any part is unsure or would undo something already stored. */
export function proposalNeedsConfirm(snapshot: FactSnapshot, intents: CustomerIntent[]): boolean {
  if (!intents.length) return false;
  return intents.some((intent) => intent.confidence < INTENT_CONFIDENCE || changesStoredFact(snapshot, intent));
}

export function pendingTurnOf(profile: Profile): CustomerIntent[] | null {
  const raw = profile.pendingTurn;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const intents = normalizeIntents((raw as { intents?: unknown }).intents);
  return intents.length ? intents : null;
}

export function withPendingTurn(profile: Profile, intents: CustomerIntent[]): Profile {
  return { ...profile, pendingTurn: { intents } };
}

export function clearPendingTurn(profile: Profile): Profile {
  return { ...profile, pendingTurn: "" };
}

/** Yes or no to the confirmation line. Any other sentence is a new message. */
export function confirmAnswer(message: string): "yes" | "no" | null {
  if (/^(כן|yes)[.!?\s]*$/i.test(message.trim())) return "yes";
  if (/^(לא|no)[.!?\s]*$/i.test(message.trim())) return "no";
  return null;
}

const TURN_SCHEMA = z.object({
  intents: z.array(z.object({
    kind: z.enum(["fact", "retract", "how_to", "answer"]),
    fact: z.string().optional(),
    value: z.string().optional(),
    target: z.enum(["id_card_back", "latest"]).optional(),
    detail: z.enum(["short", "steps"]).optional(),
    confidence: z.number(),
  })),
});

function turnPrompt(input: { message: string; snapshot: FactSnapshot; lastAgentMessage: string; openSlot: string }): string {
  return [
    "Read one customer message during a mortgage document checklist.",
    "Return every intent in the message. Return an empty list when nothing should change.",
    "Empty list for: a question (אם יש לי הלוואות זה משנה?, אפשר לשלוח רישיון במקום?), filler (בעצם) with no new fact, and זה לא נטען or זה לא ברור.",
    "fact values: loans known|none; employment salaried|self_employed|controlling_shareholder|both|other; second_borrower yes|no; first_home true|false; couple_split yes|no; salary_deposit yes|no; more_loans yes|no.",
    "אני שכיר וגם עצמאי is employment both. הלוואה נוספת is more_loans, not loans known.",
    "retract when they say the file they sent was the wrong document. target id_card_back when they name a licence or the other side, otherwise latest.",
    "how_to steps for where to get a document or they did not understand. how_to short for a bare אין לי while a document is open.",
    "answer yes|no only when the message is just yes or no to the last question.",
    "confidence is 0 to 1.",
    `Profile: ${JSON.stringify(input.snapshot)}`,
    `Open document: ${input.openSlot || "none"}`,
    `Last agent message: ${input.lastAgentMessage || "none"}`,
    `Customer: ${input.message}`,
  ].join("\n");
}

/**
 * One structured read. Patterns run only when the model is off or the call throws.
 * A successful empty list is kept.
 */
export async function readCustomerTurn(
  input: { message: string; snapshot: FactSnapshot; lastAgentMessage: string; openSlot?: string },
  deps?: { complete?: (prompt: string) => Promise<unknown> },
): Promise<CustomerTurnRead> {
  const fallback = (): CustomerTurnRead => ({ intents: fallbackIntents(input.message, input.snapshot), source: "fallback" });
  if (!deps?.complete && !llmConfigured()) return fallback();
  try {
    const prompt = turnPrompt({ ...input, openSlot: input.openSlot ?? "" });
    const raw = deps?.complete
      ? await deps.complete(prompt)
      : (await generateObject({ model: chatModel(), schema: TURN_SCHEMA, prompt })).object;
    return { intents: normalizeIntents(raw), source: "model" };
  } catch {
    return fallback();
  }
}

export type AppliedTurn = {
  profile: Profile;
  changed: boolean;
  revisions: FactRevision[];
  loansCleared: boolean;
};

/** Apply fact intents. The caller decides whether a confirmation already happened. */
export function applyTurnFacts(profile: Profile, intents: CustomerIntent[], now = new Date()): AppliedTurn {
  return applyFactIntents(profile, intents, now);
}
