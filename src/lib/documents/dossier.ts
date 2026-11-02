import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { copyFor, replyLang } from "@/lib/copy";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { loadInstanceConfig } from "@/lib/capability-instances";
import { documentApiKey, parseDocumentConfig, type DocumentConfig } from "@/lib/flow/document-config";
import { capabilityState } from "@/lib/flow/registry";
import type { TurnContext } from "@/lib/flow/types";
import { extractDocument, type DocExtraction } from "./extract";
import { docLabel, requiredSlots, type Profile, type RulesDocument } from "./rules";
import { isUploadableFile } from "./file-types";
import { slotNeedsUpload, smartClientFor, type SmartClient } from "./smart-npv";
import {
  commitSlot,
  freshDossier,
  judgeFile,
  missingLabels,
  type DossierState,
  type SlotState,
} from "./validate";

const MAX_BYTES = 8_000_000;

export type StoredAttachment = {
  url?: string;
  mime: string;
  filename: string;
  bytesEnc?: string;
};

export type DocumentsTurnState = {
  configured: boolean;
  runIngest: boolean;
  /** Every unfinished file on this turn is a type Smart NPV will not store. */
  unsupportedOnly: boolean;
  status: string;
  activeStage: string;
  missing: string[];
};

type ExtractFn = typeof extractDocument;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asSlots(value: unknown): SlotState[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((slot) => ({
    id: String(slot.id ?? ""),
    docType: String(slot.docType ?? ""),
    stage: String(slot.stage ?? ""),
    index: typeof slot.index === "number" ? slot.index : 0,
    status: slot.status === "uploaded" ? "uploaded" : "missing",
    failCount: typeof slot.failCount === "number" ? slot.failCount : 0,
    lastReason: typeof slot.lastReason === "string" ? slot.lastReason : "",
    remoteId: typeof slot.remoteId === "string" ? slot.remoteId : "",
    filename: typeof slot.filename === "string" ? slot.filename : "",
  }));
}

function asProfile(value: unknown): Profile {
  return isRecord(value) ? value : {};
}

function attachmentsOf(metadata: unknown): StoredAttachment[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.attachments)) return [];
  return metadata.attachments.filter(isRecord).map((item) => ({
    url: typeof item.url === "string" ? item.url : undefined,
    mime: typeof item.mime === "string" ? item.mime : "application/octet-stream",
    filename: typeof item.filename === "string" && item.filename.trim() ? item.filename.trim() : "file",
    bytesEnc: typeof item.bytesEnc === "string" ? item.bytesEnc : undefined,
  }));
}

export function nationalIdFromText(text: string): string {
  const match = text.match(/\b\d{8,9}\b/);
  return match?.[0] ?? "";
}

async function readConfig(tenantId: string): Promise<DocumentConfig | null> {
  try {
    const raw = await loadInstanceConfig({ tenantId, capabilityId: "documents" });
    if (!raw.baseUrl) return null;
    return parseDocumentConfig(raw, typeof raw.apiKeyEnc === "string" ? raw.apiKeyEnc : "");
  } catch {
    return null;
  }
}

async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`attachment ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("too_large");
  return bytes;
}

function stateOf(row: {
  status: string;
  smartClientId: string;
  profile: unknown;
  slots: unknown;
  activeStage: string;
}): DossierState {
  return {
    status: row.status === "needs_id" || row.status === "complete" || row.status === "blocked"
      ? row.status
      : "gathering",
    smartClientId: row.smartClientId,
    profile: asProfile(row.profile),
    slots: asSlots(row.slots),
    activeStage: row.activeStage,
  };
}

/** How many lead messages, ending at the trigger, a turn will scan for unfinished files. */
export const INGEST_MESSAGE_WINDOW = 20;

export type InboundFile = {
  messageId: string;
  attachment: StoredAttachment;
};

type LeadMessageRow = {
  id: string;
  text: string;
  metadata: unknown;
  createdAt: Date;
};

/**
 * The triggering message, then older ones. A newer lead message is left for its own turn
 * so a text reply cannot hide the file that started this turn.
 */
export function selectIngestMessages<T extends { id: string; createdAt: Date }>(
  newestFirst: T[],
  trigger: T | null,
): T[] {
  const eligible = trigger
    ? newestFirst.filter((message) => message.createdAt.getTime() <= trigger.createdAt.getTime())
    : newestFirst;
  const window = eligible.slice(0, INGEST_MESSAGE_WINDOW);
  if (trigger && !window.some((message) => message.id === trigger.id)) window.push(trigger);
  return [...window].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function finishedKey(messageId: string, filename: string): string {
  return `${messageId}\0${filename}`;
}

/** Attachments that do not yet have a rejected or uploaded row for that message. */
export function pendingFiles(
  messages: { id: string; metadata: unknown }[],
  finished: { messageId: string; filename: string }[],
): InboundFile[] {
  const done = new Set(finished.map((row) => finishedKey(row.messageId, row.filename)));
  const files: InboundFile[] = [];
  for (const message of messages) {
    for (const attachment of attachmentsOf(message.metadata)) {
      if (done.has(finishedKey(message.id, attachment.filename))) continue;
      files.push({ messageId: message.id, attachment });
    }
  }
  return files;
}

function nationalIdFromTexts(texts: string[]): string {
  for (const text of texts) {
    const id = nationalIdFromText(text);
    if (id) return id;
  }
  return "";
}

function sameNeedsId(row: { status: string; profile: unknown; slots: unknown }, typedId: string): boolean {
  if (row.status !== "needs_id") return false;
  if (asSlots(row.slots).length > 0) return false;
  return String(asProfile(row.profile).lookupId ?? "") === typedId;
}

function warnDocuments(msg: string, fields: Record<string, string | number>): void {
  console.warn(JSON.stringify({ msg, ...fields }));
}

async function loadIngestWindow(args: {
  tenantId: string;
  conversationId: string;
  triggerMessageId?: string;
}): Promise<{ messages: LeadMessageRow[]; newestText: string; files: InboundFile[] }> {
  const trigger = args.triggerMessageId
    ? await prisma.message.findFirst({
        where: {
          id: args.triggerMessageId,
          tenantId: args.tenantId,
          conversationId: args.conversationId,
          role: "lead",
        },
        select: { id: true, text: true, metadata: true, createdAt: true },
      })
    : null;
  const [rows, newest] = await Promise.all([
    prisma.message.findMany({
      where: {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        role: "lead",
        ...(trigger ? { createdAt: { lte: trigger.createdAt } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: INGEST_MESSAGE_WINDOW,
      select: { id: true, text: true, metadata: true, createdAt: true },
    }),
    prisma.message.findFirst({
      where: { tenantId: args.tenantId, conversationId: args.conversationId, role: "lead" },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    }),
  ]);
  const messages = selectIngestMessages(rows, trigger);
  const finished =
    messages.length === 0
      ? []
      : await prisma.leadDocument.findMany({
          where: {
            tenantId: args.tenantId,
            messageId: { in: messages.map((message) => message.id) },
            status: { in: ["rejected", "uploaded"] },
          },
          select: { messageId: true, filename: true },
        });
  return { messages, newestText: newest?.text ?? "", files: pendingFiles(messages, finished) };
}

export async function loadDocumentsTurnState(args: {
  tenantId: string;
  leadId: string;
  conversationId: string;
  triggerMessageId?: string;
}): Promise<DocumentsTurnState> {
  const config = await readConfig(args.tenantId);
  if (!config) {
    return { configured: false, runIngest: false, unsupportedOnly: false, status: "", activeStage: "", missing: [] };
  }
  const [dossier, inbound, stored] = await Promise.all([
    prisma.dossier.findFirst({
      where: { tenantId: args.tenantId, leadId: args.leadId },
      orderBy: { createdAt: "desc" },
    }),
    loadIngestWindow(args),
    prisma.leadDocument.count({
      where: { tenantId: args.tenantId, leadId: args.leadId, status: "stored" },
    }),
  ]);
  const state = dossier ? stateOf(dossier) : null;
  const unsupportedOnly =
    stored === 0 &&
    inbound.files.length > 0 &&
    inbound.files.every((file) => !isUploadableFile(file.attachment.mime, file.attachment.filename));
  const runIngest = !state || state.status === "needs_id" || inbound.files.length > 0 || stored > 0;
  return {
    configured: true,
    runIngest,
    unsupportedOnly,
    status: state?.status ?? "",
    activeStage: state?.activeStage ?? "",
    missing: state ? missingLabels(state, config.rules, "en") : [],
  };
}

function reasonText(chat: ReturnType<typeof copyFor>["chat"], reason: string): string {
  return chat.documents.reasons[reason] ?? chat.documents.reasons.unreadable ?? reason;
}

async function markRejected(opts: {
  tenantId: string;
  leadId: string;
  dossierId: string;
  messageId: string;
  filename: string;
  mime: string;
  reason: string;
  existingId?: string;
  docType?: string;
}): Promise<void> {
  const data = {
    status: "rejected" as const,
    bytesEnc: null,
    docType: opts.docType ?? "",
    validation: { reason: opts.reason } as Prisma.InputJsonValue,
  };
  if (opts.existingId) {
    await prisma.leadDocument.update({ where: { id: opts.existingId }, data });
    return;
  }
  await prisma.leadDocument.create({
    data: {
      tenantId: opts.tenantId,
      leadId: opts.leadId,
      dossierId: opts.dossierId,
      messageId: opts.messageId,
      filename: opts.filename,
      mime: opts.mime,
      ...data,
    },
  });
}

type DossierRow = {
  id: string;
  status: string;
  smartClientId: string;
  profile: unknown;
  slots: unknown;
  activeStage: string;
};

type IngestJob = {
  id?: string;
  messageId: string;
  filename: string;
  mime: string;
  bytes: Buffer;
  resume?: { slotId: string; docType: string };
};

type IngestLines = {
  ctx: TurnContext;
  chat: ReturnType<typeof copyFor>["chat"];
  lines: string[];
};

function phoneOf(ctx: TurnContext): string {
  return (
    ctx.channel?.customerPhone ||
    (typeof ctx.lead.fields.phone === "string" ? ctx.lead.fields.phone : "") ||
    ctx.lead.externalUserId
  );
}

/** Bad file types only. Skips the model path's lookup when every new file is one Smart NPV will refuse. */
async function rejectUnsupportedFiles(opts: IngestLines & { row: DossierRow | null; files: InboundFile[] }): Promise<{ ok: boolean; reply: string } | null> {
  const open = !opts.row || (opts.row.status !== "blocked" && opts.row.status !== "complete");
  const flagged = capabilityState<DocumentsTurnState>(opts.ctx, "documents")?.unsupportedOnly === true;
  if (!open || !flagged || opts.files.length === 0) return null;
  if (!opts.files.every((file) => !isUploadableFile(file.attachment.mime, file.attachment.filename))) return null;
  let row = opts.row;
  if (!row) {
    row = await prisma.dossier.create({
      data: {
        tenantId: opts.ctx.tenantId,
        leadId: opts.ctx.lead.id,
        conversationId: opts.ctx.conversation.id,
        status: "needs_id",
        profile: {} as Prisma.InputJsonValue,
        slots: [] as Prisma.InputJsonValue,
        activeStage: "",
        smartClientId: "",
      },
    });
  }
  for (const file of opts.files) {
    await markRejected({
      tenantId: opts.ctx.tenantId,
      leadId: opts.ctx.lead.id,
      dossierId: row.id,
      messageId: file.messageId,
      filename: file.attachment.filename,
      mime: file.attachment.mime,
      reason: "unsupported_type",
    });
    opts.lines.push(
      opts.chat.documents.rejected(file.attachment.filename, reasonText(opts.chat, "unsupported_type")),
    );
  }
  await safeRefreshLeadState(opts.ctx.tenantId, opts.ctx.lead.id);
  return { ok: true, reply: opts.lines.filter(Boolean).join("\n") };
}

/** Find the Smart NPV client, or leave the dossier on needs_id. */
async function matchClient(opts: IngestLines & {
  config: DocumentConfig;
  client: SmartClient;
  lang: "en" | "he";
  row: DossierRow | null;
  typedId: string;
  hasFiles: boolean;
}): Promise<{ row: DossierRow | null; done?: { ok: boolean; reply: string } }> {
  let { row } = opts;
  if (row && row.status !== "needs_id") return { row };
  const found =
    (await opts.client.findClient({ phone: phoneOf(opts.ctx) })) ||
    (opts.typedId ? await opts.client.findClient({ nationalId: opts.typedId }) : null);
  if (!found) {
    const reply = opts.typedId ? opts.chat.documents.notFound : opts.chat.documents.askId;
    if (row && sameNeedsId(row, opts.typedId)) return { row, done: { ok: true, reply } };
    const data = {
      tenantId: opts.ctx.tenantId,
      leadId: opts.ctx.lead.id,
      conversationId: opts.ctx.conversation.id,
      status: "needs_id",
      profile: { lookupId: opts.typedId } as Prisma.InputJsonValue,
      slots: [] as Prisma.InputJsonValue,
      activeStage: "",
      smartClientId: "",
    };
    row = row
      ? await prisma.dossier.update({ where: { id: row.id }, data })
      : await prisma.dossier.create({ data });
    await safeRefreshLeadState(opts.ctx.tenantId, opts.ctx.lead.id);
    return { row, done: { ok: true, reply } };
  }
  const opened = freshDossier({
    smartClientId: found.clientId,
    profile: found.profile,
    slots: requiredSlots(found.profile, opts.config.rules),
  });
  const data = {
    status: opened.status,
    smartClientId: opened.smartClientId,
    profile: opened.profile as Prisma.InputJsonValue,
    slots: opened.slots as unknown as Prisma.InputJsonValue,
    activeStage: opened.activeStage,
    conversationId: opts.ctx.conversation.id,
  };
  row = row
    ? await prisma.dossier.update({ where: { id: row.id }, data })
    : await prisma.dossier.create({
        data: { tenantId: opts.ctx.tenantId, leadId: opts.ctx.lead.id, ...data },
      });
  if (!opts.hasFiles) {
    opts.lines.push(opts.chat.documents.askStage(missingLabels(opened, opts.config.rules, opts.lang).join(", ")));
  }
  return { row };
}

async function rejectEmptyStored(tenantId: string, dossierId: string): Promise<void> {
  const cleared = await prisma.leadDocument.updateMany({
    where: {
      tenantId,
      dossierId,
      status: "stored",
      OR: [{ bytesEnc: null }, { bytesEnc: "" }],
    },
    data: {
      status: "rejected",
      bytesEnc: null,
      validation: { reason: "missing_bytes" } as Prisma.InputJsonValue,
    },
  });
  if (cleared.count > 0) {
    warnDocuments("documents.empty_stored", { tenantId, dossierId, count: cleared.count });
  }
}

/** Download new files and reload ciphertext that is still waiting. Unsupported types are rejected here. */
async function collectJobs(opts: IngestLines & { row: DossierRow; files: InboundFile[] }): Promise<IngestJob[]> {
  await rejectEmptyStored(opts.ctx.tenantId, opts.row.id);
  const pendingDocs = await prisma.leadDocument.findMany({
    where: { tenantId: opts.ctx.tenantId, dossierId: opts.row.id, status: "stored" },
    orderBy: { createdAt: "asc" },
  });
  const jobs: IngestJob[] = [];
  for (const doc of pendingDocs) {
    if (!doc.bytesEnc) continue;
    let bytes: Buffer;
    try {
      bytes = decryptBytes(doc.bytesEnc);
    } catch (err) {
      warnDocuments("documents.empty_stored", {
        tenantId: opts.ctx.tenantId,
        filename: doc.filename,
        error: err instanceof Error ? err.message : String(err),
      });
      await markRejected({
        tenantId: opts.ctx.tenantId,
        leadId: opts.ctx.lead.id,
        dossierId: opts.row.id,
        messageId: doc.messageId,
        filename: doc.filename,
        mime: doc.mime,
        reason: "missing_bytes",
        existingId: doc.id,
      });
      continue;
    }
    if (bytes.length === 0) {
      await markRejected({
        tenantId: opts.ctx.tenantId,
        leadId: opts.ctx.lead.id,
        dossierId: opts.row.id,
        messageId: doc.messageId,
        filename: doc.filename,
        mime: doc.mime,
        reason: "missing_bytes",
        existingId: doc.id,
      });
      continue;
    }
    const validation = isRecord(doc.validation) ? doc.validation : {};
    jobs.push({
      id: doc.id,
      messageId: doc.messageId,
      filename: doc.filename,
      mime: doc.mime,
      bytes,
      resume:
        validation.accepted === true && typeof validation.slotId === "string"
          ? { slotId: validation.slotId, docType: String(validation.docType ?? "") }
          : undefined,
    });
  }
  for (const file of opts.files) {
    const { attachment } = file;
    if (jobs.some((job) => job.messageId === file.messageId && job.filename === attachment.filename)) continue;
    if (!isUploadableFile(attachment.mime, attachment.filename)) {
      opts.lines.push(opts.chat.documents.rejected(attachment.filename, reasonText(opts.chat, "unsupported_type")));
      await markRejected({
        tenantId: opts.ctx.tenantId,
        leadId: opts.ctx.lead.id,
        dossierId: opts.row.id,
        messageId: file.messageId,
        filename: attachment.filename,
        mime: attachment.mime,
        reason: "unsupported_type",
      });
      continue;
    }
    let bytes: Buffer | null = null;
    try {
      bytes = attachment.bytesEnc
        ? decryptBytes(attachment.bytesEnc)
        : attachment.url
          ? await downloadUrl(attachment.url)
          : null;
    } catch (err) {
      const reason = err instanceof Error && err.message === "too_large" ? "too_large" : "unreadable";
      warnDocuments("documents.download_failed", {
        filename: attachment.filename,
        mime: attachment.mime,
        error: err instanceof Error ? err.message : String(err),
      });
      opts.lines.push(opts.chat.documents.rejected(attachment.filename, reasonText(opts.chat, reason)));
      continue;
    }
    if (!bytes) continue;
    jobs.push({ messageId: file.messageId, filename: attachment.filename, mime: attachment.mime, bytes });
  }
  return jobs;
}

/** Read the file against the open slots. A rejection is one write. */
async function judgeFileJob(opts: IngestLines & {
  config: DocumentConfig;
  extract: ExtractFn;
  lang: "en" | "he";
  row: DossierRow;
  state: DossierState;
  job: IngestJob;
}): Promise<{ state: DossierState; escalated: boolean; accepted: { slotId: string; docType: string } | null }> {
  if (opts.job.resume) {
    return {
      state: opts.state,
      escalated: false,
      accepted: { slotId: opts.job.resume.slotId, docType: opts.job.resume.docType },
    };
  }
  const open = opts.state.slots
    .filter((slot) => slot.status === "missing")
    .map((slot) => ({
      docType: slot.docType,
      label: docLabel(opts.config.rules, slot.docType, "en"),
      fields: opts.config.rules.documents[slot.docType]?.fields ?? [],
    }));
  const extracted: DocExtraction = await opts.extract({
    bytes: opts.job.bytes,
    mime: opts.job.mime,
    filename: opts.job.filename,
    open,
  });
  const judged = judgeFile(opts.state, opts.config.rules, extracted);
  if (judged.kind !== "reject") {
    return { state: opts.state, escalated: false, accepted: { slotId: judged.slotId, docType: judged.docType } };
  }
  const state = judged.state;
  const label = docLabel(
    opts.config.rules,
    state.slots.find((slot) => slot.id === judged.slotId)?.docType ?? "",
    opts.lang,
  );
  opts.lines.push(opts.chat.documents.rejected(label || opts.job.filename, reasonText(opts.chat, judged.reason)));
  if (opts.job.id) {
    await prisma.leadDocument.update({
      where: { id: opts.job.id },
      data: { status: "rejected", bytesEnc: null, validation: { reason: judged.reason } },
    });
  } else {
    await prisma.leadDocument.create({
      data: {
        tenantId: opts.ctx.tenantId,
        leadId: opts.ctx.lead.id,
        dossierId: opts.row.id,
        messageId: opts.job.messageId,
        filename: opts.job.filename,
        mime: opts.job.mime,
        docType: extracted.docType,
        status: "rejected",
        validation: { reason: judged.reason } as Prisma.InputJsonValue,
        bytesEnc: null,
      },
    });
  }
  if (!judged.escalated) return { state, escalated: false, accepted: null };
  await prisma.$transaction([
    prisma.hitlTask.create({
      data: {
        tenantId: opts.ctx.tenantId,
        conversationId: opts.ctx.conversation.id,
        leadId: opts.ctx.lead.id,
        type: "more_info",
        reason: "document_review",
        payload: { summary: judged.reason },
        status: "open",
      },
    }),
    prisma.conversation.update({
      where: { id: opts.ctx.conversation.id },
      data: { status: "waiting_human", flowState: "waiting_human" },
    }),
  ]);
  opts.ctx.conversation.status = "waiting_human";
  opts.ctx.conversation.flowState = "waiting_human";
  opts.lines.push(opts.chat.documents.escalated);
  return { state, escalated: true, accepted: null };
}

/** Send an accepted file to Smart NPV, or keep the ciphertext when the upload fails. */
async function uploadAcceptedFile(opts: IngestLines & {
  config: DocumentConfig;
  client: SmartClient;
  lang: "en" | "he";
  row: DossierRow;
  state: DossierState;
  job: IngestJob;
  slotId: string;
  docType: string;
}): Promise<{ state: DossierState; accepted: boolean }> {
  const { job, slotId, docType } = opts;
  let state = opts.state;
  const target = state.slots.find((slot) => slot.id === slotId);
  if (target && !slotNeedsUpload(target)) {
    if (target.status !== "uploaded") state = commitSlot(state, slotId, target.remoteId, job.filename);
    if (job.id) {
      await prisma.leadDocument.update({
        where: { id: job.id },
        data: { status: "uploaded", remoteId: target.remoteId, bytesEnc: null, docType },
      });
    } else {
      await prisma.leadDocument.create({
        data: {
          tenantId: opts.ctx.tenantId,
          leadId: opts.ctx.lead.id,
          dossierId: opts.row.id,
          messageId: job.messageId,
          filename: job.filename,
          mime: job.mime,
          docType,
          status: "uploaded",
          remoteId: target.remoteId,
          validation: { accepted: true } as Prisma.InputJsonValue,
          bytesEnc: null,
        },
      });
    }
    opts.lines.push(opts.chat.documents.received(docLabel(opts.config.rules, docType, opts.lang)));
    return { state, accepted: false };
  }

  const docRow = job.id
    ? { id: job.id }
    : await prisma.leadDocument.create({
        data: {
          tenantId: opts.ctx.tenantId,
          leadId: opts.ctx.lead.id,
          dossierId: opts.row.id,
          messageId: job.messageId,
          filename: job.filename,
          mime: job.mime,
          docType,
          status: "stored",
          validation: { accepted: true, slotId, docType } as Prisma.InputJsonValue,
          bytesEnc: encryptBytes(job.bytes),
        },
      });
  try {
    const uploaded = await opts.client.upload({
      clientId: state.smartClientId,
      docType,
      filename: job.filename,
      mime: job.mime,
      bytes: job.bytes,
    });
    state = commitSlot(state, slotId, uploaded.remoteId, job.filename);
    await prisma.leadDocument.update({
      where: { id: docRow.id },
      data: {
        status: "uploaded",
        docType,
        remoteId: uploaded.remoteId,
        bytesEnc: null,
        validation: { accepted: true } as Prisma.InputJsonValue,
      },
    });
    opts.lines.push(opts.chat.documents.received(docLabel(opts.config.rules, docType, opts.lang)));
    return { state, accepted: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (error === "unsupported_type") {
      await prisma.leadDocument.update({
        where: { id: docRow.id },
        data: { status: "rejected", bytesEnc: null, validation: { reason: "unsupported_type" } },
      });
      opts.lines.push(opts.chat.documents.rejected(job.filename, reasonText(opts.chat, "unsupported_type")));
      return { state, accepted: false };
    }
    warnDocuments("documents.upload_failed", { filename: job.filename, error });
    await prisma.leadDocument.update({
      where: { id: docRow.id },
      data: {
        status: "stored",
        docType,
        bytesEnc: encryptBytes(job.bytes),
        validation: { accepted: true, slotId, docType } as Prisma.InputJsonValue,
      },
    });
    opts.lines.push(opts.chat.documents.uploadFailed);
    return { state, accepted: false };
  }
}

export async function runDocumentsIngest(
  ctx: TurnContext,
  deps?: { extract?: ExtractFn; client?: SmartClient },
): Promise<{ ok: boolean; reply: string }> {
  const config = await readConfig(ctx.tenantId);
  const lang = replyLang(ctx);
  const chat = copyFor(lang, { gender: ctx.agent.persona?.gender }).chat;
  if (!config) return { ok: false, reply: chat.documents.notConfigured };

  const client = deps?.client ?? smartClientFor({
    baseUrl: config.baseUrl,
    apiKey: documentApiKey(config),
  });
  const extract = deps?.extract ?? extractDocument;
  const lines: string[] = [];
  const inbound = await loadIngestWindow({
    tenantId: ctx.tenantId,
    conversationId: ctx.conversation.id,
    triggerMessageId: ctx.triggerMessageId,
  });
  const typedId = nationalIdFromTexts([
    inbound.newestText,
    ...[...inbound.messages].reverse().map((message) => message.text),
  ]);
  let row: DossierRow | null = await prisma.dossier.findFirst({
    where: { tenantId: ctx.tenantId, leadId: ctx.lead.id },
    orderBy: { createdAt: "desc" },
  });

  const rejectedTypes = await rejectUnsupportedFiles({ ctx, chat, lines, row, files: inbound.files });
  if (rejectedTypes) return rejectedTypes;

  const matched = await matchClient({
    ctx,
    chat,
    lines,
    config,
    client,
    lang,
    row,
    typedId,
    hasFiles: inbound.files.length > 0,
  });
  if (matched.done) return matched.done;
  row = matched.row;
  if (!row) return { ok: false, reply: chat.documents.notConfigured };

  let state = stateOf(row);
  if (state.status === "blocked" || state.status === "complete") {
    await safeRefreshLeadState(ctx.tenantId, ctx.lead.id);
    return {
      ok: true,
      reply: lines.join(" ") || (state.status === "complete" ? chat.documents.complete : chat.documents.escalated),
    };
  }

  const jobs = await collectJobs({ ctx, chat, lines, row, files: inbound.files });
  let acceptedAny = false;
  for (const job of jobs) {
    if (!isUploadableFile(job.mime, job.filename)) {
      lines.push(chat.documents.rejected(job.filename, reasonText(chat, "unsupported_type")));
      await markRejected({
        tenantId: ctx.tenantId,
        leadId: ctx.lead.id,
        dossierId: row.id,
        messageId: job.messageId,
        filename: job.filename,
        mime: job.mime,
        reason: "unsupported_type",
        existingId: job.id,
      });
      continue;
    }
    const judged = await judgeFileJob({ ctx, chat, lines, config, extract, lang, row, state, job });
    state = judged.state;
    if (judged.escalated) break;
    if (!judged.accepted) continue;
    const uploaded = await uploadAcceptedFile({
      ctx,
      chat,
      lines,
      config,
      client,
      lang,
      row,
      state,
      job,
      slotId: judged.accepted.slotId,
      docType: judged.accepted.docType,
    });
    state = uploaded.state;
    if (uploaded.accepted) acceptedAny = true;
  }

  if (state.status === "complete") lines.push(chat.documents.complete);
  else if (acceptedAny && state.status === "gathering") {
    const next = missingLabels(state, config.rules, lang);
    if (next.length) lines.push(chat.documents.askStage(next.join(", ")));
  }

  await prisma.dossier.update({
    where: { id: row.id },
    data: {
      status: state.status,
      slots: state.slots as unknown as Prisma.InputJsonValue,
      activeStage: state.activeStage,
      profile: state.profile as Prisma.InputJsonValue,
      smartClientId: state.smartClientId,
    },
  });
  await safeRefreshLeadState(ctx.tenantId, ctx.lead.id);
  const reply = lines.filter(Boolean).join("\n");
  return { ok: true, reply: reply || chat.documents.askStage(missingLabels(state, config.rules, lang).join(", ")) };
}

export async function loadDocumentChecklist(tenantId: string, leadId: string, lang: "en" | "he") {
  const [config, dossier] = await Promise.all([
    readConfig(tenantId),
    prisma.dossier.findFirst({
      where: { tenantId, leadId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!dossier) return null;
  const rules: RulesDocument | null = config?.rules ?? null;
  const state = stateOf(dossier);
  return {
    status: state.status,
    activeStage: state.activeStage,
    slots: state.slots.map((slot) => ({
      id: slot.id,
      label: rules ? docLabel(rules, slot.docType, lang) : slot.docType,
      stage: slot.stage,
      status: slot.status,
      lastReason: slot.lastReason,
      filename: slot.filename,
      remoteId: slot.remoteId,
    })),
  };
}
