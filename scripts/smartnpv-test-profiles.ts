/**
 * Happy-path Smart NPV profiles for the documents checklist.
 *
 * Borrower 1 keeps the phone, email, and national id the demo lead already
 * matches. Borrower 2, when present, uses a different id and phone so that
 * sender still maps to borrower 1.
 *
 * Two clients stay: employment code 0 on borrower 1, and code 0 on borrower 2.
 * Every other profile belongs to a flow. Flow `a` is one account, then a loan.
 * Flow `b` starts with no accounts, then two accounts, then the couple loan.
 * Flow `c` is code 5, the same file list as self-employed, and it is deleted
 * when that run passes.
 * The runner creates that client, updates it in a1, a2 order, and deletes it
 * when the last profile passes. The file prefix is `5_a1`: profile sequence,
 * flow letter, and the order that client is updated.
 *
 * Questions are what the agent asks before any file. Files are what opens
 * after the happy-path answers: no second borrower when the file has one
 * person, first home yes, and no loans only when liabilities is empty.
 * Income and transaction_type are omitted. They do not choose the list.
 *
 * A live account row is bank_id, branch_id, account_number, owner_details,
 * and a uuid that Get client returns. A loan row is balance, repayments,
 * final_liability, liability_type, description_liability, and a uuid.
 * New rows omit the uuid. An empty liabilities array stays "unknown", so
 * the agent asks. Zero account rows still open one unnamed statement.
 *
 * Usage, for a client that stays between runs:
 *   npx tsx scripts/smartnpv-test-profiles.ts self-employed
 *
 * The document runner plays one scenario, including a flow client:
 *   npx tsx scripts/document-scenarios/run.ts --only salaried-one
 *
 * The key is SMARTNPV_API_KEY, or the documents key already saved for this
 * tenant. It is not printed. SMARTNPV_BASE_URL must stay https://www.snpv.co.il.
 */

import { prisma } from "../src/lib/db";
import { documentApiKey, documentConfigFromStored } from "../src/lib/flow/document-config";

const HOST = (process.env.SMARTNPV_BASE_URL || "https://www.snpv.co.il").replace(/\/$/, "");
/** Original sync-check client. The scenario runner still uses this. It can be deleted once a replacement is chosen. */
export const PREVIOUS_TEST_UUID = "350d8dd9-85f2-4214-a558-e3de662be6d2";
export const TEST_UUID = PREVIOUS_TEST_UUID;
/**
 * Created with status_report_1 "0". Update stores that code as empty, so a
 * profile whose borrower 1 is self-employed uses this client and does not
 * send the 0 again. Safe to delete after the probe.
 */
export const STATUS_ZERO_PROBE_UUID = "d85388e0-74b6-4c3b-9c92-12fa7772c3e0";
/**
 * Created with borrower 1 code 2 and borrower 2 code 0. Update cannot store
 * the second code, and the status-0 client has to keep code 0 on borrower 1.
 */
export const MIXED_COUPLE_UUID = "5b1cb5aa-042c-4b80-8138-4595bdc4a72b";

export function assertSmartHost(): void {
  if (HOST !== "https://www.snpv.co.il") {
    throw new Error("Refusing to send the key to a host other than https://www.snpv.co.il");
  }
}

const borrower1 = {
  firstname_1: "בדיקה",
  lastname_1: "סנכרון",
  phone_1: "0526595639",
  email_1: "naveine96@gmail.com",
  id_1: "205707714",
};

const noBorrower2 = {
  firstname_2: "",
  lastname_2: "",
  id_2: "",
  phone_2: "",
  email_2: "",
  status_report_2: "",
};

function account(accountNumber: string) {
  return {
    bank_id: "4",
    branch_id: "22",
    account_number: accountNumber,
    owner_details: "בדיקה",
  };
}

const loan = {
  balance: "250000",
  repayments: "1500",
  final_liability: "01/05/2036",
  liability_type: "2",
  description_liability: "בדיקה",
};

export type TestProfile = {
  /** Output files are prefixed with this, so profile 1 is `1_…`. */
  seq: number;
  id: string;
  /** Asked before any document, for this payload as stored. */
  questions: string[];
  /** Open after the happy-path answers described above. */
  files: string[];
  params: Record<string, unknown>;
};

export const TEST_PROFILES: TestProfile[] = [
  {
    seq: 1,
    id: "salaried-one",
    questions: ["second borrower", "first home", "loans"],
    files: ["ID", "appendix", "3 payslips", "1 statement"],
    params: {
      ...borrower1,
      ...noBorrower2,
      status_report_1: "2",
      banks_accounts: [account("10001")],
      liabilities: [],
    },
  },
  {
    seq: 2,
    id: "salaried-couple-loans",
    questions: ["first home"],
    files: [
      "ID for each borrower",
      "appendix for each borrower",
      "3 payslips for each borrower",
      "1 statement",
      "1 loan balance",
    ],
    params: {
      ...borrower1,
      status_report_1: "2",
      firstname_2: "בדיקה",
      lastname_2: "שני",
      id_2: "123456789",
      phone_2: "0500000002",
      email_2: "",
      status_report_2: "2",
      banks_accounts: [account("10001"), account("10002")],
      liabilities: [loan],
    },
  },
  {
    seq: 3,
    id: "self-employed",
    questions: ["second borrower", "first home", "loans"],
    files: ["ID", "appendix", "tax assessment for the prior year", "accountant letter for this year", "1 statement"],
    params: {
      ...borrower1,
      ...noBorrower2,
      status_report_1: "0",
      banks_accounts: [account("10001")],
      liabilities: [],
    },
  },
  {
    seq: 4,
    id: "controlling-shareholder",
    // Code 3 opens the shareholder letter. The salary-deposit question is not asked.
    questions: ["second borrower", "first home", "loans"],
    files: ["ID", "appendix", "3 payslips", "controlling-shareholder letter", "1 statement"],
    params: {
      ...borrower1,
      ...noBorrower2,
      status_report_1: "3",
      banks_accounts: [account("10001")],
      liabilities: [],
    },
  },
  {
    seq: 5,
    id: "employment-unknown",
    questions: ["second borrower", "employment", "first home", "loans"],
    files: ["ID", "appendix", "3 payslips", "1 statement"],
    params: {
      ...borrower1,
      ...noBorrower2,
      status_report_1: "",
      banks_accounts: [account("10001")],
      liabilities: [],
    },
  },
  {
    seq: 6,
    id: "salaried-loans",
    questions: ["second borrower", "first home"],
    files: ["ID", "appendix", "3 payslips", "1 statement", "1 loan balance"],
    params: {
      ...borrower1,
      ...noBorrower2,
      status_report_1: "2",
      banks_accounts: [account("10001")],
      liabilities: [{ ...loan }],
    },
  },
  {
    seq: 7,
    id: "salaried-two-accounts",
    questions: ["second borrower", "first home", "loans"],
    files: ["ID", "appendix", "3 payslips", "2 statements"],
    params: {
      ...borrower1,
      ...noBorrower2,
      status_report_1: "2",
      banks_accounts: [account("10001"), account("10002")],
      liabilities: [],
    },
  },
  {
    seq: 8,
    id: "salaried-no-accounts",
    questions: ["second borrower", "first home", "loans"],
    files: ["ID", "appendix", "3 payslips", "1 unnamed statement"],
    params: {
      ...borrower1,
      ...noBorrower2,
      status_report_1: "2",
      banks_accounts: [],
      liabilities: [],
    },
  },
  {
    seq: 9,
    id: "mixed-couple",
    questions: ["first home", "loans"],
    files: [
      "ID for each borrower",
      "appendix for each borrower",
      "3 payslips for borrower 1",
      "tax assessment and accountant letter for borrower 2",
      "1 statement",
    ],
    params: {
      ...borrower1,
      status_report_1: "2",
      firstname_2: "בדיקה",
      lastname_2: "שני",
      id_2: "123456789",
      phone_2: "0500000002",
      email_2: "",
      status_report_2: "0",
      banks_accounts: [account("10001")],
      liabilities: [],
    },
  },
  {
    seq: 10,
    id: "code-5",
    questions: ["second borrower", "first home", "loans"],
    files: ["ID", "appendix", "tax assessment for the prior year", "accountant letter for this year", "1 statement"],
    params: {
      ...borrower1,
      ...noBorrower2,
      status_report_1: "5",
      banks_accounts: [account("10001")],
      liabilities: [],
    },
  },
];

export type FactQuestion = "second_borrower" | "employment" | "first_home" | "loans";

export type DocumentScenario = {
  id: string;
  profileId: string;
  /** Questions in the order they should open, and the phrase that answers each one. */
  answers: { question: FactQuestion; text: string }[];
  /** Accepted files of each kind that close the run. */
  files: Record<string, number>;
};

const onePerson = [
  { question: "second_borrower" as const, text: "לא" },
  { question: "first_home" as const, text: "כן" },
  { question: "loans" as const, text: "אין הלוואות" },
];

const salariedFiles = { id_card: 1, id_appendix: 1, payslip: 3, bank_statement: 1 };

/** What the document runner plays. salaried-one-adds-borrower reuses the salaried-one payload. */
export const DOCUMENT_SCENARIOS: DocumentScenario[] = [
  { id: "salaried-one", profileId: "salaried-one", answers: onePerson, files: salariedFiles },
  {
    id: "salaried-one-adds-borrower",
    profileId: "salaried-one",
    answers: [
      { question: "second_borrower", text: "כן" },
      { question: "employment", text: "אני שכיר" },
      { question: "first_home", text: "כן" },
      { question: "loans", text: "אין הלוואות" },
    ],
    files: { id_card: 2, id_appendix: 2, payslip: 6, bank_statement: 1 },
  },
  {
    id: "salaried-couple-loans",
    profileId: "salaried-couple-loans",
    answers: [{ question: "first_home", text: "כן" }],
    files: { id_card: 2, id_appendix: 2, payslip: 6, bank_statement: 1, loan_balances: 1 },
  },
  {
    id: "self-employed",
    profileId: "self-employed",
    answers: onePerson,
    files: { id_card: 1, id_appendix: 1, tax_assessment: 1, accountant_letter: 1, bank_statement: 1 },
  },
  {
    id: "controlling-shareholder",
    profileId: "controlling-shareholder",
    answers: onePerson,
    files: { id_card: 1, id_appendix: 1, payslip: 3, controlling_shareholder_letter: 1, bank_statement: 1 },
  },
  {
    id: "employment-unknown",
    profileId: "employment-unknown",
    answers: [
      { question: "second_borrower", text: "לא" },
      { question: "employment", text: "אני שכיר" },
      { question: "first_home", text: "כן" },
      { question: "loans", text: "אין הלוואות" },
    ],
    files: salariedFiles,
  },
  {
    id: "salaried-loans",
    profileId: "salaried-loans",
    answers: [
      { question: "second_borrower", text: "לא" },
      { question: "first_home", text: "כן" },
    ],
    files: { ...salariedFiles, loan_balances: 1 },
  },
  {
    id: "salaried-two-accounts",
    profileId: "salaried-two-accounts",
    answers: onePerson,
    files: { ...salariedFiles, bank_statement: 2 },
  },
  {
    id: "salaried-no-accounts",
    profileId: "salaried-no-accounts",
    answers: onePerson,
    files: salariedFiles,
  },
  {
    id: "mixed-couple",
    profileId: "mixed-couple",
    answers: [
      { question: "first_home", text: "כן" },
      { question: "loans", text: "אין הלוואות" },
    ],
    files: {
      id_card: 2,
      id_appendix: 2,
      payslip: 3,
      tax_assessment: 1,
      accountant_letter: 1,
      bank_statement: 1,
    },
  },
  {
    id: "code-5",
    profileId: "code-5",
    answers: onePerson,
    files: { id_card: 1, id_appendix: 1, tax_assessment: 1, accountant_letter: 1, bank_statement: 1 },
  },
];

type Envelope = {
  response?: boolean;
  responseCode?: number;
  responseMessage?: string;
  responseClientFields?: Record<string, unknown> | null;
  responseDocuments?: unknown[] | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function apiKey(): Promise<string> {
  const fromEnv = process.env.SMARTNPV_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const rows = await prisma.capabilityInstance.findMany({
    where: { capabilityId: "documents", enabled: true },
    select: { config: true },
  });
  for (const row of rows) {
    const config = documentConfigFromStored(row.config);
    if (config.apiKeyEnc) return documentApiKey(config);
  }
  throw new Error("Set SMARTNPV_API_KEY or save a documents key.");
}

const STANDING_UUIDS = new Set([TEST_UUID, STATUS_ZERO_PROBE_UUID, MIXED_COUPLE_UUID]);

/**
 * Clients that stay between runs. Code 0 is set at create and left out of
 * later updates. Every other profile uses a flow client that the runner
 * creates and deletes.
 */
export function clientUuidFor(params: Record<string, unknown>): string | null {
  if (params.status_report_2 === "0") return MIXED_COUPLE_UUID;
  if (params.status_report_1 === "0") return STATUS_ZERO_PROBE_UUID;
  return null;
}

export type FlowId = "a" | "b" | "c";

export type FlowStep = {
  flow: FlowId;
  /** 1-based position in the flow. a1 runs before a2 on the same client. */
  order: number;
  /** `5_a1`: profile sequence, flow, and order. */
  prefix: string;
  last: boolean;
};

/**
 * Profiles that share a client, in the order that client is updated.
 * `a` starts with one account and no loans. `b` starts with neither.
 * `c` is code 5 on one account and no loans, the same list as self-employed.
 */
export const CLIENT_FLOWS: { id: FlowId; scenarios: string[] }[] = [
  {
    id: "a",
    scenarios: [
      "employment-unknown",
      "salaried-one",
      "salaried-one-adds-borrower",
      "controlling-shareholder",
      "salaried-loans",
    ],
  },
  {
    id: "b",
    scenarios: ["salaried-no-accounts", "salaried-two-accounts", "salaried-couple-loans"],
  },
  {
    id: "c",
    scenarios: ["code-5"],
  },
];

export function flowStep(scenarioId: string): FlowStep | null {
  for (const flow of CLIENT_FLOWS) {
    const index = flow.scenarios.indexOf(scenarioId);
    if (index < 0) continue;
    const scenario = DOCUMENT_SCENARIOS.find((item) => item.id === scenarioId);
    const profile = TEST_PROFILES.find((item) => item.id === scenario?.profileId);
    if (!profile) return null;
    return {
      flow: flow.id,
      order: index + 1,
      prefix: `${profile.seq}_${flow.id}${index + 1}`,
      last: index === flow.scenarios.length - 1,
    };
  }
  return null;
}

/** Comparison files and the transcript. A shared client uses the flow prefix. */
export function runStem(scenarioId: string): string {
  const scenario = DOCUMENT_SCENARIOS.find((item) => item.id === scenarioId);
  const profile = TEST_PROFILES.find((item) => item.id === scenario?.profileId);
  if (!scenario || !profile) return scenarioId;
  const step = flowStep(scenarioId);
  return step ? `${step.prefix}_${scenario.id}` : `${profile.seq}_${scenario.id}`;
}

/** Profile params from the start of the flow through this scenario. */
export function flowProfilesThrough(scenarioId: string): TestProfile[] {
  const step = flowStep(scenarioId);
  if (!step) return [];
  const flow = CLIENT_FLOWS.find((item) => item.id === step.flow);
  if (!flow) return [];
  return flow.scenarios.slice(0, step.order).flatMap((id) => {
    const scenario = DOCUMENT_SCENARIOS.find((item) => item.id === id);
    const profile = TEST_PROFILES.find((item) => item.id === scenario?.profileId);
    return profile ? [profile] : [];
  });
}

/**
 * The first profile always starts a new client. A later profile updates the
 * saved client when that client still matches the previous profile. Anything
 * else is created again and the earlier profiles are applied in order.
 */
export function flowClientAction(input: { order: number; saved: boolean; previousMatches: boolean }): "recreate" | "update" {
  if (input.order === 1 || !input.saved || !input.previousMatches) return "recreate";
  return "update";
}

/**
 * Drop employment code 0 before an update. The update API stores it as empty.
 * A client created with 0 keeps the code when the field is left out.
 */
export function updateParams(params: Record<string, unknown>): Record<string, unknown> {
  const next = { ...params };
  for (const key of ["status_report_1", "status_report_2"]) {
    if (next[key] === "0") delete next[key];
  }
  return next;
}

function fieldText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

const ACCOUNT_FIELDS = ["bank_id", "branch_id", "account_number", "owner_details"] as const;
const LOAN_FIELDS = ["balance", "repayments", "final_liability", "liability_type", "description_liability"] as const;
const HIDDEN_FIELDS = new Set(["phone_1", "phone_2", "email_1", "email_2", "id_1", "id_2"]);

/** Fields the profile set that the fetched client does not have. Identity values are not included. */
export function clientMismatches(expected: Record<string, unknown>, fetched: Record<string, unknown> | null): string[] {
  if (!fetched) return ["client was not returned"];
  const mismatches: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    if (key === "banks_accounts" || key === "liabilities") {
      const wantRows = Array.isArray(want) ? want : [];
      const gotRows = Array.isArray(fetched[key]) ? fetched[key] : [];
      if (wantRows.length !== gotRows.length) {
        mismatches.push(`${key} ${gotRows.length}, expected ${wantRows.length}`);
        continue;
      }
      const fields = key === "banks_accounts" ? ACCOUNT_FIELDS : LOAN_FIELDS;
      wantRows.forEach((row, index) => {
        const got = gotRows[index];
        if (!isRecord(row) || !isRecord(got)) {
          mismatches.push(`${key}[${index}]`);
          return;
        }
        for (const field of fields) {
          if (fieldText(row[field]) !== fieldText(got[field])) mismatches.push(`${key}[${index}].${field}`);
        }
      });
      continue;
    }
    if (fieldText(fetched[key]) === fieldText(want)) continue;
    mismatches.push(
      HIDDEN_FIELDS.has(key)
        ? `${key} differs`
        : `${key} is ${JSON.stringify(fieldText(fetched[key]))}, expected ${JSON.stringify(fieldText(want))}`,
    );
  }
  return mismatches;
}

/** Every file name on the test client. The same name can appear more than once. */
export async function listUploadedNames(key: string, uuid = TEST_UUID): Promise<string[]> {
  assertSmartHost();
  const query = new URLSearchParams({ api_key: key, uuid });
  const res = await fetch(`${HOST}/api/v2/clients/get_uploaded_documents?${query}`);
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (!res.ok || body?.response === false) {
    throw new Error(body?.responseMessage || `upload list failed (${res.status})`);
  }
  const rows = Array.isArray(body?.responseDocuments) ? body.responseDocuments : [];
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const name = [row.file_name, row.fileName, row.name].find((value) => typeof value === "string" && value.trim());
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  });
}

export async function getClient(key: string, uuid = TEST_UUID): Promise<Record<string, unknown> | null> {
  const query = new URLSearchParams({ api_key: key, type: "uuid", uuid });
  const res = await fetch(`${HOST}/api/v2/clients/get?${query}`);
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (!res.ok || !body?.response || !isRecord(body.responseClientFields)) return null;
  return body.responseClientFields;
}

function storedShape(fields: Record<string, unknown>) {
  const accounts = Array.isArray(fields.banks_accounts) ? fields.banks_accounts : [];
  const loans = Array.isArray(fields.liabilities) ? fields.liabilities : [];
  const account = isRecord(accounts[0]) ? accounts[0] : null;
  return {
    statusReport1: typeof fields.status_report_1 === "string" ? fields.status_report_1 : "",
    borrower2: typeof fields.id_2 === "string" && fields.id_2.trim().length > 0,
    accounts: accounts.length,
    accountHasUuid: typeof account?.uuid === "string" && account.uuid.trim().length > 0,
    liabilities: loans.length,
  };
}

/** Keep an existing row's uuid so a repeat update replaces it instead of adding another. */
export function stampRowUuids(
  params: Record<string, unknown>,
  current: Record<string, unknown> | null,
): Record<string, unknown> {
  const next = { ...params };
  for (const key of ["banks_accounts", "liabilities"] as const) {
    const rows = Array.isArray(next[key]) ? next[key] : null;
    const prior = Array.isArray(current?.[key]) ? current[key] : [];
    if (!rows) continue;
    next[key] = rows.map((row, index) => {
      if (!isRecord(row)) return row;
      const existing = isRecord(prior[index]) ? prior[index] : null;
      const uuid = typeof existing?.uuid === "string" ? existing.uuid.trim() : "";
      return uuid && !row.uuid ? { ...row, uuid } : row;
    });
  }
  return next;
}

/** A flow run creates its client with an old date so today's sync leaves it out. */
export const FLOW_CREATED = "1577836800";

export async function createClient(key: string, params: Record<string, unknown>, flow: FlowId): Promise<string> {
  assertSmartHost();
  const res = await fetch(`${HOST}/api/v2/clients/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      params: { ...params, created: FLOW_CREATED, note_details: `Zapidly flow ${flow}` },
    }),
  });
  const body = (await res.json().catch(() => null)) as Envelope & { responseID?: string } | null;
  if (!res.ok || body?.response === false || !body?.responseID) {
    throw new Error(body?.responseMessage || `create failed (${res.status})`);
  }
  return body.responseID;
}

export async function deleteClient(key: string, uuid: string): Promise<void> {
  assertSmartHost();
  if (STANDING_UUIDS.has(uuid)) throw new Error("Refusing to delete a standing test client.");
  const res = await fetch(`${HOST}/api/v2/clients/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, uuid }),
  });
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (res.ok && body?.response !== false) return;
  const still = await getClient(key, uuid);
  if (still) throw new Error(body?.responseMessage || `delete failed (${res.status})`);
}

export async function updateClient(key: string, params: Record<string, unknown>, uuid = TEST_UUID): Promise<string> {
  const res = await fetch(`${HOST}/api/v2/clients/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, uuid, params }),
  });
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (!res.ok || body?.response === false) {
    throw new Error(body?.responseMessage || `update failed (${res.status})`);
  }
  return body?.responseMessage ?? "";
}

async function applyProfile(profile: TestProfile, key: string) {
  const uuid = clientUuidFor(profile.params);
  if (!uuid) throw new Error("This profile uses a flow client. Run it with scripts/document-scenarios/run.ts.");
  const current = await getClient(key, uuid);
  const responseMessage = await updateClient(key, stampRowUuids(updateParams(profile.params), current), uuid);
  const fields = await getClient(key, uuid);
  const stored = fields ? storedShape(fields) : null;
  const mismatches = clientMismatches(profile.params, fields);
  const accountsIgnored = stored != null && stored.accounts === 0 && Array.isArray(profile.params.banks_accounts) && profile.params.banks_accounts.length > 0;
  console.log(
    JSON.stringify({
      uuid,
      profile: profile.id,
      responseMessage,
      stored,
      mismatches,
      ...(accountsIgnored
        ? { note: "Account rows were not stored. The statement still opens as one unnamed file." }
        : {}),
    }),
  );
}

async function main() {
  assertSmartHost();
  const id = process.argv[2]?.trim() || "self-employed";
  const profile = TEST_PROFILES.find((item) => item.id === id);
  if (!profile) throw new Error(`Unknown profile. Use one of: ${TEST_PROFILES.map((item) => item.id).join(", ")}`);
  const key = await apiKey();
  await applyProfile(profile, key);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("smartnpv-test-profiles.ts") || entry.endsWith("smartnpv-test-profiles.js")) {
  main()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : "update failed");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
