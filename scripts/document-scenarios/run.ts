/**
 * Play one document scenario against a Smart NPV test client.
 *
 *   npx tsx scripts/document-scenarios/run.ts --only salaried-one
 *
 * A profile whose borrower 1 is employment code 0 uses the client created
 * with that code. A profile whose borrower 2 is code 0 uses the mixed-couple
 * client. Those two stay. Every other profile belongs to a flow. The runner
 * creates that client, updates it in a1, a2 order, and deletes it when the
 * last profile passes. A later profile updates the saved client when it still
 * matches the previous profile. Otherwise the client is created again and the
 * earlier profiles are applied in order. The update does not send code 0.
 * After the fetch, the run stops unless the stored fields match the profile.
 * Console output has no phone, national id, or API key.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { encryptBytes } from "../../src/lib/crypto";
import { persistInboundIfNew } from "../../src/lib/conversations";
import { DEMO_PHONE_PREFIX } from "../../src/lib/demo-phone";
import { phoneKey, storedClientByPhone } from "../../src/lib/documents/client-sync";
import { factsOpen, nextQuestion } from "../../src/lib/documents/facts";
import type { Profile } from "../../src/lib/documents/rules";
import { createdDay, mapSmartProfile, toSmartPhone } from "../../src/lib/documents/smart-npv";
import type { SlotState } from "../../src/lib/documents/validate";
import { documentConfigFromStored } from "../../src/lib/flow/document-config";
import { runTurnNow, tryDispatchNudgeEvent, tryDispatchOwnerAlertEvents } from "../../src/lib/flow/run-turn";
import {
  assertSmartHost,
  clientMismatches,
  clientUuidFor,
  createClient,
  deleteClient,
  DOCUMENT_SCENARIOS,
  flowClientAction,
  flowProfilesThrough,
  flowStep,
  getClient,
  apiKey,
  stampRowUuids,
  MIXED_COUPLE_UUID,
  STATUS_ZERO_PROBE_UUID,
  TEST_PROFILES,
  TEST_UUID,
  listUploadedNames,
  runStem,
  updateClient,
  updateParams,
  type DocumentScenario,
  type FlowId,
} from "../smartnpv-test-profiles";

const RUNS = path.join("scenario-runs", "documents");
const RESULTS = path.join(RUNS, "results.md");
const FLOW_CLIENTS = path.join(RUNS, "flow-clients.json");
const FACTS = new Set(["second_borrower", "couple_split", "split_who", "employment", "first_home", "loans", "salary_deposit", "accounts"]);

const FIXTURES: Record<string, string> = {
  id_card: "test/fixtures/documents/תעודת זהות עם ספח copy.jpg",
  id_card_back: "test/fixtures/documents/תעודת זהות חלק אחורי.jpg",
  id_appendix: "test/fixtures/documents/תעודת זהות עם ספח copy.jpg",
  payslip: "test/fixtures/documents/payslips_2026-08_2026-10.pdf",
  bank_statement: "test/fixtures/documents/bank_statement__leumi_2026-08_2026-10.pdf",
  loan_balances: "test/fixtures/documents/loan_balances__יתרת_הלוואות.pdf",
  tax_assessment: "test/fixtures/documents/אישור פתיחת תיק במס הכנסה 2025.pdf",
  accountant_letter: "assets/blank-forms/אישור רואה חשבון עוסק מורשה.pdf",
  controlling_shareholder_letter: "assets/blank-forms/אישור רואה חשבון לבעל שליטה (1).pdf",
};

/** Borrower 2 has a different card. The front photo has no appendix page. */
const BORROWER_2_FIXTURES: Record<string, string> = {
  id_card: "test/fixtures/documents/borrower_2_id_front.jpeg",
  id_card_back: "test/fixtures/documents/borrower_2_id_back.jpeg",
  id_appendix: "test/fixtures/documents/sefach.png",
};

function loadEnv(): void {
  const prior = new Set(Object.keys(process.env));
  const fromFile = new Set<string>();
  const apply = (file: string) => {
    if (!existsSync(file)) return;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (prior.has(key) && !fromFile.has(key)) continue;
      process.env[key] = value;
      fromFile.add(key);
    }
  };
  apply(".env");
  apply(".env.local");
}

function onlyArg(): string {
  const args = process.argv.slice(2);
  const inline = args.find((arg) => arg.startsWith("--only="));
  if (inline) return inline.slice("--only=".length).trim();
  const index = args.indexOf("--only");
  return index >= 0 ? (args[index + 1] ?? "").trim() : "";
}

function resumeArg(): boolean {
  return process.argv.slice(2).includes("--resume");
}

async function latestTranscript(stem: string): Promise<string> {
  const names = await readdir(RUNS).catch(() => [] as string[]);
  return names.filter((name) => name.startsWith(`${stem}-`) && name.endsWith(".md")).sort().at(-1) ?? "";
}

function jerusalemStamp(now = new Date()): { label: string; file: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = get("hour");
  const minute = get("minute");
  return { label: `${day} ${hour}:${minute}`, file: `${day}-${hour}${minute}` };
}

function publicReason(raw: string): string {
  return raw
    .replace(/\+?972\d{8,9}/g, "")
    .replace(/\b0\d{8,9}\b/g, "")
    .replace(/\b\d{9}\b/g, "")
    .replace(/api_key=[^&\s]+/gi, "")
    .replace(/[A-Za-z0-9_-]{32,}/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function slotsOf(value: unknown): SlotState[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SlotState => Boolean(item) && typeof item === "object");
}

function uploadedCounts(slots: SlotState[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of slots) {
    if (slot.status !== "uploaded" || !slot.docType) continue;
    counts[slot.docType] = (counts[slot.docType] ?? 0) + 1;
  }
  return counts;
}

function nextOwed(expected: Record<string, number>, counts: Record<string, number>): string | null {
  for (const [docType, count] of Object.entries(expected)) {
    if ((counts[docType] ?? 0) < count) return docType;
  }
  return null;
}

/** The PDF name Smart NPV was given. A repeat run on the same day keeps this name and adds another copy. */
function smartFileName(filename: string): string {
  return /_\d{4}-\d{2}-\d{2}_\d{2}\.pdf$/i.test(filename.trim()) ? filename.trim() : "";
}

function nameCounts(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

/**
 * Each accepted upload should show up once more, under the name the dossier stored.
 * The same name may already be there from an earlier run, so the check is the increase.
 */
function uploadGap(before: string[], after: string[], expected: string[]): string {
  const beforeCounts = nameCounts(before);
  const afterCounts = nameCounts(after);
  const added = after.length - before.length;
  const missing = expected.filter((name) => (afterCounts.get(name) ?? 0) - (beforeCounts.get(name) ?? 0) < 1);
  if (missing.length) return `smart upload missing ${missing.length} of ${expected.length}`;
  if (added !== expected.length) return `smart files +${added}, expected +${expected.length}`;
  return "";
}

async function expectedSmartNames(tenantId: string, leadId: string): Promise<string[]> {
  const row = await prisma.dossier.findFirst({
    where: { tenantId, leadId },
    orderBy: { updatedAt: "desc" },
    select: { slots: true },
  });
  const names = new Set<string>();
  for (const slot of slotsOf(row?.slots)) {
    if (slot.status !== "uploaded") continue;
    const name = smartFileName(slot.filename ?? "");
    if (name) names.add(name);
  }
  return [...names];
}

function gapText(expected: Record<string, number>, slots: SlotState[]): string {
  const counts = uploadedCounts(slots);
  const parts: string[] = [];
  for (const [docType, count] of Object.entries(expected)) {
    const have = counts[docType] ?? 0;
    if (have >= count) continue;
    const reason = slots.find((slot) => slot.docType === docType && slot.status !== "uploaded" && slot.lastReason)?.lastReason ?? "";
    parts.push(reason ? `${docType} ${have}/${count} (${reason})` : `${docType} ${have}/${count}`);
  }
  return parts.join("; ");
}

type Open = { kind: string; slot?: string };

function openOf(profile: Profile): Open | null {
  const question = nextQuestion(profile);
  if (!question) return null;
  return { kind: question.kind, slot: "slot" in question ? question.slot : undefined };
}

async function documentsTenant(): Promise<string> {
  const rows = await prisma.capabilityInstance.findMany({
    where: { capabilityId: "documents", enabled: true },
    select: { tenantId: true, config: true },
  });
  const withKey = rows.find((row) => {
    try {
      return Boolean(documentConfigFromStored(row.config).apiKeyEnc);
    } catch {
      return false;
    }
  });
  const tenantId = (withKey ?? rows[0])?.tenantId;
  if (!tenantId) throw new Error("No documents capability is enabled.");
  return tenantId;
}

type FlowClients = Partial<Record<FlowId, string>>;

async function readFlowClients(): Promise<FlowClients> {
  if (!existsSync(FLOW_CLIENTS)) return {};
  const parsed = JSON.parse(await readFile(FLOW_CLIENTS, "utf8")) as Record<string, unknown>;
  const clients: FlowClients = {};
  if (typeof parsed.a === "string" && parsed.a.trim()) clients.a = parsed.a.trim();
  if (typeof parsed.b === "string" && parsed.b.trim()) clients.b = parsed.b.trim();
  if (typeof parsed.c === "string" && parsed.c.trim()) clients.c = parsed.c.trim();
  return clients;
}

async function writeFlowClients(clients: FlowClients): Promise<void> {
  await mkdir(RUNS, { recursive: true });
  await writeFile(FLOW_CLIENTS, `${JSON.stringify(clients, null, 2)}\n`);
}

/** Create the flow client, or update the one the previous profile left. */
async function prepareFlowClient(key: string, scenarioId: string): Promise<string> {
  const step = flowStep(scenarioId);
  if (!step) throw new Error("This profile has no flow client.");
  const steps = flowProfilesThrough(scenarioId);
  const target = steps[steps.length - 1];
  if (!target) throw new Error("This profile has no flow client.");
  const savedClients = await readFlowClients();
  const saved = savedClients[step.flow] ?? "";
  const current = saved ? await getClient(key, saved) : null;
  const previous = steps.length > 1 ? steps[steps.length - 2] : null;
  const action = flowClientAction({
    order: step.order,
    saved: Boolean(current),
    previousMatches: previous ? clientMismatches(previous.params, current).length === 0 : false,
  });
  if (action === "update" && current) {
    await updateClient(key, stampRowUuids(updateParams(target.params), current), saved);
    return saved;
  }
  if (saved) {
    await deleteClient(key, saved);
    delete savedClients[step.flow];
  }
  const uuid = await createClient(key, steps[0].params, step.flow);
  savedClients[step.flow] = uuid;
  await writeFlowClients(savedClients);
  let fields = await getClient(key, uuid);
  for (const profile of steps) {
    await updateClient(key, stampRowUuids(updateParams(profile.params), fields), uuid);
    fields = await getClient(key, uuid);
  }
  return uuid;
}

async function releaseFlowClient(key: string, flow: FlowId): Promise<void> {
  const savedClients = await readFlowClients();
  const uuid = savedClients[flow];
  if (!uuid) return;
  await deleteClient(key, uuid);
  delete savedClients[flow];
  await writeFlowClients(savedClients);
}

async function purgeLocal(tenantId: string, leadId: string, phone: string, uuid: string): Promise<void> {
  const conversations = await prisma.conversation.findMany({
    where: { tenantId, leadId },
    select: { id: true },
  });
  const conversationIds = conversations.map((row) => row.id);
  if (conversationIds.length) {
    await prisma.message.deleteMany({ where: { tenantId, conversationId: { in: conversationIds } } });
  }
  await prisma.leadDocument.deleteMany({ where: { tenantId, leadId } });
  await prisma.dossier.deleteMany({ where: { tenantId, leadId } });
  await prisma.conversation.deleteMany({ where: { tenantId, leadId } });
  const ids = [TEST_UUID, STATUS_ZERO_PROBE_UUID, MIXED_COUPLE_UUID, uuid].filter(Boolean);
  await prisma.smartNpvClient.deleteMany({
    where: { tenantId, OR: [{ smartClientId: { in: ids } }, { phone1: phone }, { phone2: phone }] },
  });
}

function formatRow(cells: string[]): string {
  const clean = cells.map((cell) => cell.replace(/\|/g, "/").replace(/\s+/g, " ").trim());
  return `| ${clean.join(" | ")} |`;
}

async function writeResult(scenario: DocumentScenario, stamp: string, result: string, wrong: string, link: string): Promise<void> {
  const previous = existsSync(RESULTS) ? await readFile(RESULTS, "utf8") : "";
  const lines = previous ? previous.split(/\r?\n/) : [];
  const headerAt = lines.findIndex((line) => line.startsWith("| Scenario "));
  const row = formatRow([scenario.id, scenario.profileId, "", stamp, result, wrong, link]);
  if (headerAt < 0) {
    lines.push(
      "# Document scenario runs",
      "",
      "One profile per run. The runner fills Last run, Result, and What went wrong for the row it just played, and leaves every other row as it found it. Cadence stays empty. Conversation links to the transcript in this folder. A shared client is prefixed like 5_a1: profile sequence, flow, and update order. A profile with its own client keeps the profile sequence.",
      "",
      "| Scenario | Variant | Cadence | Last run | Result | What went wrong | Conversation |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      row,
      "",
    );
  } else {
    const index = lines.findIndex((line, at) => at > headerAt + 1 && line.startsWith("| ") && line.split("|")[1]?.trim() === scenario.id);
    if (index >= 0) lines[index] = row;
    else lines.splice(headerAt + 2, 0, row);
  }
  const text = lines.join("\n").replace(/\n*$/, "\n");
  await writeFile(RESULTS, text);
}

loadEnv();

async function main() {
  const id = onlyArg();
  const known = DOCUMENT_SCENARIOS.map((item) => item.id).join(", ");
  if (!id) throw new Error(`Pass --only <scenario>. Use one of: ${known}`);
  const scenario = DOCUMENT_SCENARIOS.find((item) => item.id === id);
  if (!scenario) throw new Error(`Unknown scenario. Use one of: ${known}`);
  const profile = TEST_PROFILES.find((item) => item.id === scenario.profileId);
  if (!profile) throw new Error(`Scenario ${scenario.id} has no profile.`);

  assertSmartHost();
  const resume = resumeArg();
  const stamp = jerusalemStamp();
  const stem = runStem(scenario.id);
  const step = flowStep(scenario.id);
  const priorTranscript = resume ? await latestTranscript(stem) : "";
  const transcriptName = priorTranscript || `${stem}-${stamp.file}.md`;
  const lines: string[] = priorTranscript ? [] : [`# ${scenario.id}`, ""];
  let result: "pass" | "fail" = "fail";
  let wrong = "";
  let leadId = "";
  let key = "";
  let uuid = "";

  try {
    key = await apiKey();
    const standing = clientUuidFor(profile.params);
    if (resume) {
      uuid = step ? (await readFlowClients())[step.flow] ?? "" : standing ?? "";
      if (!uuid) throw new Error(step ? "No flow client to resume." : "Client was not readable after the update.");
    } else if (step) {
      uuid = await prepareFlowClient(key, scenario.id);
    } else if (standing) {
      uuid = standing;
      const current = await getClient(key, uuid);
      await updateClient(key, stampRowUuids(updateParams(profile.params), current), uuid);
    } else {
      throw new Error("This profile has no client.");
    }
    const fields = await getClient(key, uuid);
    if (!fields) throw new Error("Client was not readable after the update.");
    const mismatches = clientMismatches(profile.params, fields);
    if (mismatches.length) {
      throw new Error(`Smart client does not match the profile: ${mismatches.join("; ")}`);
    }

    const phone = toSmartPhone(textOf(fields.phone_1) || textOf(fields.phone));
    if (!phone) throw new Error("Stored client has no phone.");
    const sender = `${DEMO_PHONE_PREFIX}${phoneKey(phone)}`;
    const name = [textOf(fields.firstname_1), textOf(fields.lastname_1)].filter(Boolean).join(" ");

    const tenantId = await documentsTenant();
    const channels = await prisma.channelConnection.findMany({
      where: { tenantId, enabled: true },
      include: { agent: true },
      orderBy: { createdAt: "asc" },
    });
    const channel = channels.find((item) => JSON.stringify(item.agent.flow ?? "").includes("documents")) ?? channels[0];
    if (!channel) throw new Error("No channel for the documents tenant.");

    let lead = await prisma.lead.findFirst({
      where: { tenantId, channelId: channel.id, externalUserId: sender },
    });
    const priorFields = asRecord(lead?.fields);
    delete priorFields.documentsUnrecognized;
    const nextFields = { ...priorFields, name: name || priorFields.name || "", phone, demoReplyHereOnly: "1" };
    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          tenantId,
          channelId: channel.id,
          externalUserId: sender,
          displayName: name,
          fields: nextFields as Prisma.InputJsonValue,
        },
      });
    } else {
      lead = await prisma.lead.update({
        where: { id: lead.id },
        data: { displayName: name || lead.displayName, fields: nextFields as Prisma.InputJsonValue },
      });
    }
    leadId = lead.id;

    if (!resume) {
      await purgeLocal(tenantId, lead.id, phone, uuid);
      await prisma.smartNpvClient.create({
        data: {
          tenantId,
          smartClientId: uuid,
          phone1: phone,
          phone2: toSmartPhone(textOf(fields.phone_2)),
          profile: mapSmartProfile(fields) as Prisma.InputJsonValue,
          createdOn: createdDay(fields.created),
        },
      });
    }
    const stored = await storedClientByPhone(tenantId, phone);
    if (!stored || stored.smartClientId !== uuid) throw new Error("Stored client did not match the sender.");

    await mkdir(RUNS, { recursive: true });
    if (!resume) {
      await writeFile(path.join(RUNS, `${stem}.smart.json`), `${JSON.stringify(fields, null, 2)}\n`);
      await writeFile(path.join(RUNS, `${stem}.mapped.json`), `${JSON.stringify(mapSmartProfile(fields), null, 2)}\n`);
    }

    const priorNames = resume ? await expectedSmartNames(tenantId, lead.id) : [];
    const beforeUploads = await listUploadedNames(key, uuid);
    const played = await play(scenario, {
      tenantId,
      leadId: lead.id,
      channelId: channel.id,
      agentId: channel.agentId,
      sender,
      phone,
      lines,
    }, { resume });
    result = played.result;
    wrong = played.wrong;
    if (result === "pass") {
      const afterUploads = await listUploadedNames(key, uuid);
      const expected = await expectedSmartNames(tenantId, lead.id);
      const wanted = resume ? expected.filter((name) => !priorNames.includes(name)) : expected;
      const gap = wanted.length
        ? uploadGap(beforeUploads, afterUploads, wanted)
        : expected.length
          ? ""
          : "no smart filename on the accepted files";
      lines.push("", `Smart NPV files: ${beforeUploads.length} before, ${afterUploads.length} after.`);
      if (gap) {
        result = "fail";
        wrong = gap;
      }
    }
  } catch (err) {
    result = "fail";
    wrong = publicReason(err instanceof Error ? err.message : String(err));
  }

  if (step?.last && result === "pass" && key && uuid) {
    try {
      await releaseFlowClient(key, step.flow);
    } catch (err) {
      result = "fail";
      wrong = publicReason(err instanceof Error ? err.message : String(err));
    }
  }

  await mkdir(RUNS, { recursive: true });
  const added = `${lines.join("\n").replace(/\n*$/, "\n")}`;
  const prior = priorTranscript ? await readFile(path.join(RUNS, priorTranscript), "utf8") : "";
  await writeFile(path.join(RUNS, transcriptName), `${prior.replace(/\n*$/, prior ? "\n" : "")}${added}`);
  const link = `[${stem}](${transcriptName})`;
  await writeResult(scenario, stamp.label, result, wrong, link);
  console.log(JSON.stringify({ scenario: scenario.id, result, wrong, leadId, transcript: transcriptName }));
  if (result !== "pass") process.exitCode = 1;
}

type PlayInput = {
  tenantId: string;
  leadId: string;
  channelId: string;
  agentId: string;
  sender: string;
  phone: string;
  lines: string[];
};

async function play(
  scenario: DocumentScenario,
  input: PlayInput,
  opts?: { resume?: boolean },
): Promise<{ result: "pass" | "fail"; wrong: string }> {
  let answered = 0;
  const attempts: Record<string, number> = {};
  let lastAction = "";
  let sameAction = 0;

  if (opts?.resume) {
    const row = await prisma.dossier.findFirst({
      where: { tenantId: input.tenantId, leadId: input.leadId },
      orderBy: { updatedAt: "desc" },
    });
    if (!row) return { result: "fail", wrong: "no dossier" };
    const profile = asRecord(row.profile) as Profile;
    if (!factsOpen(profile)) answered = scenario.answers.length;
    else {
      const open = openOf(profile);
      const index = scenario.answers.findIndex((answer) => answer.question === open?.kind);
      answered = index >= 0 ? index : scenario.answers.length;
    }
  } else {
    await sendTurn(input, "היי", null);
    if (missingReply(input.lines)) return { result: "fail", wrong: "no agent reply" };
  }
  // The first turn is the intro. The checklist opens on the next message.
  let opened = Boolean(opts?.resume);

  for (let turn = 0; turn < 48; turn += 1) {
    const row = await prisma.dossier.findFirst({
      where: { tenantId: input.tenantId, leadId: input.leadId },
      orderBy: { updatedAt: "desc" },
    });
    if (!row) {
      if (opened) return { result: "fail", wrong: "no dossier" };
      opened = true;
      await sendTurn(input, "בסדר", null);
      if (missingReply(input.lines)) return { result: "fail", wrong: "no agent reply" };
      continue;
    }

    const profile = asRecord(row.profile) as Profile;
    const slots = slotsOf(row.slots);
    const open = openOf(profile);
    const pending = scenario.answers[answered];
    if (pending) {
      if (!open || open.kind !== pending.question) {
        return { result: "fail", wrong: `expected ${pending.question}, got ${open?.kind ?? "nothing"}` };
      }
      const action = `answer:${pending.question}`;
      if (action === lastAction) sameAction += 1;
      else sameAction = 0;
      lastAction = action;
      if (sameAction >= 2) return { result: "fail", wrong: `answer was not accepted for ${pending.question}` };
      await sendTurn(input, pending.text, null);
      answered += 1;
      continue;
    }

    if (factsOpen(profile)) {
      return { result: "fail", wrong: `still open: ${open?.kind ?? "unknown"}` };
    }
    if (row.status === "blocked") return { result: "fail", wrong: "collection stopped" };

    const owed = nextOwed(scenario.files, uploadedCounts(slots));
    let docType = "";
    let text = "";
    if (open?.kind === "id_biometric") text = "לא";
    else if (open?.kind === "more_loans") text = "אין הלוואות נוספות";
    else if (open?.kind === "more_photos") text = "אין עוד";
    else if (open?.kind === "id_back") docType = "id_card_back";
    else if (open?.kind === "id_appendix") docType = "id_appendix";
    else if (open) return { result: "fail", wrong: `unexpected question ${open.kind}` };
    else if (!owed) return { result: "pass", wrong: "" };
    else docType = owed;
    const borrower = docType ? borrowerFor(slots, docType, open?.slot) : "1";

    if (!docType && !text) return { result: "fail", wrong: gapText(scenario.files, slots) || "files still missing" };

    const action = docType ? `file:${docType}` : `text:${text}`;
    if (action === lastAction) sameAction += 1;
    else sameAction = 0;
    lastAction = action;
    if (sameAction >= 2) {
      const reason = slots.find((slot) => slot.lastReason)?.lastReason ?? "";
      const where = open?.kind ?? (docType || "files");
      return { result: "fail", wrong: publicReason(reason ? `stuck on ${where}: ${reason}` : `stuck on ${where}`) };
    }
    if (docType) {
      attempts[docType] = (attempts[docType] ?? 0) + 1;
      const allowed = (scenario.files[docType] ?? 1) + 2;
      if (attempts[docType] > allowed) {
        return { result: "fail", wrong: publicReason(gapText(scenario.files, slots) || `no fixture`) };
      }
      const fixture = fixturePath(docType, borrower);
      if (!fixture) return { result: "fail", wrong: `no fixture for ${docType}` };
      await sendTurn(input, "מצורף", { docType, file: fixture });
      if (missingReply(input.lines)) return { result: "fail", wrong: "no agent reply" };
      continue;
    }
    await sendTurn(input, text, null);
    if (missingReply(input.lines)) return { result: "fail", wrong: "no agent reply" };
  }
  return { result: "fail", wrong: "stopped after 48 turns" };
}

function missingReply(lines: string[]): boolean {
  const agent = [...lines].reverse().find((line) => line.startsWith("**Agent:**"));
  return !agent || agent === "**Agent:** (no reply)";
}

function borrowerFor(slots: SlotState[], docType: string, openSlot?: string): string {
  if (openSlot === "1" || openSlot === "2") return openSlot;
  const missing = slots.find((slot) => slot.docType === docType && slot.status !== "uploaded");
  return missing?.borrower === "2" ? "2" : "1";
}

function fixturePath(docType: string, borrower = "1"): string {
  const identity = docType === "id_card" || docType === "id_card_back" || docType === "id_appendix";
  const relative = borrower === "2"
    ? BORROWER_2_FIXTURES[docType] ?? (identity ? undefined : FIXTURES[docType])
    : FIXTURES[docType];
  if (!relative) return "";
  const absolute = path.join(process.cwd(), relative);
  return existsSync(absolute) ? absolute : "";
}

function mimeOf(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/pdf";
}

async function sendTurn(
  input: PlayInput,
  text: string,
  file: { docType: string; file: string } | null,
): Promise<void> {
  const bytes = file ? await readFile(file.file) : null;
  const filename = file ? path.basename(file.file) : "";
  const started = new Date();
  const inserted = await persistInboundIfNew({
    tenantId: input.tenantId,
    channelId: input.channelId,
    agentId: input.agentId,
    providerMessageId: `doc-scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    from: input.sender,
    text,
    extraFields: { phone: input.phone, demoReplyHereOnly: "1" },
    attachments: bytes
      ? [{ mime: mimeOf(file!.file), filename, bytesEnc: encryptBytes(bytes) }]
      : undefined,
  });
  if (!inserted) throw new Error("Message was not stored.");
  if (inserted.leadId !== input.leadId) throw new Error("Message landed on a different lead.");
  const turn = await runTurnNow({
    tenantId: input.tenantId,
    conversationId: inserted.conversationId,
    triggerMessageId: inserted.messageId,
    inboundAt: Date.now(),
  });
  await tryDispatchNudgeEvent("nudgeEvent" in turn ? turn.nudgeEvent : null);
  await tryDispatchOwnerAlertEvents(turn.ownerAlertEvents);
  if ("skipped" in turn && turn.skipped) throw new Error(`turn skipped: ${turn.skipped}`);
  const reply = await prisma.message.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: inserted.conversationId,
      role: "agent",
      createdAt: { gte: started },
    },
    orderBy: { createdAt: "desc" },
    select: { text: true },
  });
  input.lines.push(`**Lead:** ${file ? `${text} (${file.docType})` : text}`, "", `**Agent:** ${reply?.text?.trim() || "(no reply)"}`, "");
}

main()
  .catch((err: unknown) => {
    console.error(publicReason(err instanceof Error ? err.message : "run failed"));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
