import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { copyFor } from "@/lib/copy";
import { hasAgentReplied } from "@/lib/flow/intro";
import { withFirstMessageIntro } from "@/lib/persona/greeting";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { loadInstanceConfig } from "@/lib/capability-instances";
import {
  DEFAULT_MAX_REJECT_TRIES,
  DEFAULT_REJECT_COOLDOWN_MINUTES,
  documentApiKey,
  isTestLead,
  parseDocumentConfig,
  type DocumentConfig,
} from "@/lib/flow/document-config";
import { capabilityState } from "@/lib/flow/registry";
import { loadTurnContext, type ConnectionView } from "@/lib/conversations";
import { reopenConversation } from "@/lib/flow/rotate-conversation";
import type { TurnContext } from "@/lib/flow/types";
import { sendZernioInboxMessage } from "@/lib/zernio";
import { blankFormFilePath, blankFormHref } from "./blank-form";
import { extractDocument, type DocExtraction } from "./extract";
import {
  applyTurnFacts,
  clearPendingTurn,
  confirmAnswer,
  pendingTurnOf,
  proposalNeedsConfirm,
  readCustomerTurn,
  withPendingTurn,
  type CustomerIntent,
  type FactSnapshot,
} from "./customer-turn";
import { applyCustomerAnswers, applyExtractedBiometric, borrowerFileWho, borrowersOf, declinesExistingLoans, factsFromClient, factsOpen, firstHomeOf, loansOf, missingTheDocument, nextQuestion, openQuestions, retractsLastFile, secondBorrowerOf, type OpenQuestion } from "./facts";
import { docLabel, type BlankFormDef, type Profile, type RulesDocument, type Slot } from "./rules";
import { checklistSlots, nextCollectionStageId, releasedStageId } from "./mortgage-rules";
import { isImageFile, isUploadableFile, smartUploadName, uploadDay } from "./file-types";
import { filesToPdf, photoDone } from "./images";
import { slotNeedsUpload, smartClientFor, type SmartClient } from "./smart-npv";
import {
  activeStageOf,
  commitSlot,
  dossierDone,
  extraPayslipSlotIds,
  formatStatementMonth,
  freshDossier,
  isOutstanding,
  judgeFile,
  missingLabels,
  monthsIn,
  noteSlotMonths,
  priorCalendarMonths,
  recentPayslipMonths,
  recordMonths,
  reopenReturnedSlots,
  slotDisplayLabel,
  type DossierState,
  type SlotState,
} from "./validate";
import { explicitReplyLanguage, isAttachmentCaption, stickyReplyLanguage } from "@/lib/flow/locale";

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
  asks: OpenQuestion[];
  /** A file arrived on this turn, so ingest runs even before the intro. */
  pendingFile: boolean;
};

/** The turn already carries the Zernio ids. `connection` is set by loadTurnContext. */
type IngestTurn = TurnContext & { connection?: Pick<ConnectionView, "zernioAccountId"> };

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
    ...(typeof slot.borrower === "string" && slot.borrower ? { borrower: slot.borrower } : {}),
    ...(typeof slot.accountId === "string" && slot.accountId ? { accountId: slot.accountId } : {}),
    ...(typeof slot.year === "number" ? { year: slot.year } : {}),
    ...(typeof slot.altGroup === "string" && slot.altGroup ? { altGroup: slot.altGroup } : {}),
    ...(typeof slot.collectionStage === "string" && slot.collectionStage ? { collectionStage: slot.collectionStage } : {}),
    ...(stringList(slot.months) ? { months: stringList(slot.months) } : {}),
    ...(stringList(slot.coveredMonths) ? { coveredMonths: stringList(slot.coveredMonths) } : {}),
  }));
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return items.length ? items : undefined;
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

function warnDocuments(msg: string, fields: Record<string, unknown> = {}): void {
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
            status: { in: ["rejected", "uploaded", "stored"] },
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
    return {
      configured: false,
      runIngest: false,
      unsupportedOnly: false,
      status: "",
      activeStage: "",
      missing: [],
      asks: [],
      pendingFile: false,
    };
  }
  const [dossier, inbound, stored, lastAgent] = await Promise.all([
    prisma.dossier.findFirst({
      where: { tenantId: args.tenantId, leadId: args.leadId },
      orderBy: { createdAt: "desc" },
    }),
    loadIngestWindow(args),
    prisma.leadDocument.count({
      where: { tenantId: args.tenantId, leadId: args.leadId, status: "stored" },
    }),
    prisma.message.findFirst({
      where: { tenantId: args.tenantId, conversationId: args.conversationId, role: { in: ["agent", "human"] } },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    }),
  ]);
  const state = dossier ? stateOf(dossier) : null;
  const unsupportedOnly =
    stored === 0 &&
    inbound.files.length > 0 &&
    inbound.files.every((file) => !isUploadableFile(file.attachment.mime, file.attachment.filename));
  const wouldAnswer = state
    ? applyCustomerAnswers(state.profile, inbound.newestText, new Date(), {
        bare: bareAnswerAllowed(state.profile, lastAgent?.text ?? ""),
      }).changed
    : false;
  const closingPhotos = Boolean(state?.profile.imageBatchSlot && photoDone(inbound.newestText));
  const escalatePending = Boolean(state && escalateOfferPending(state.profile));
  const coolPending = Boolean(state && coolActive(state.profile));
  const runIngest =
    !state ||
    state.status === "needs_id" ||
    inbound.files.length > 0 ||
    stored > 0 ||
    wouldAnswer ||
    closingPhotos ||
    (escalatePending && Boolean(inbound.newestText.trim())) ||
    (coolPending && inbound.files.length > 0) ||
    ((state.status === "gathering" || state.status === "needs_id") && Boolean(inbound.newestText.trim()));
  return {
    configured: true,
    runIngest,
    unsupportedOnly,
    status: state?.status ?? "",
    activeStage: state?.activeStage ?? "",
    missing: state ? missingLabels(state, config.rules, "en") : [],
    asks: state ? openQuestions(state.profile) : [],
    pendingFile: inbound.files.length > 0,
  };
}

function reasonText(chat: ReturnType<typeof copyFor>["chat"], reason: string): string {
  return chat.documents.reasons[reason] ?? chat.documents.reasons.unreadable ?? reason;
}

function coolUntilOf(profile: Profile): Date | null {
  const raw = typeof profile.rejectCoolUntil === "string" ? profile.rejectCoolUntil : "";
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function coolActive(profile: Profile, now = new Date()): boolean {
  const until = coolUntilOf(profile);
  return Boolean(until && until.getTime() > now.getTime());
}

function coolMinutesLeft(profile: Profile, now = new Date()): number {
  const until = coolUntilOf(profile);
  if (!until) return 0;
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
}

function escalateOfferPending(profile: Profile): boolean {
  return profile.escalateOffer === "pending";
}

/** Yes/no to the consultant hand-off, only when that question is open. */
export function escalateAnswer(message: string): "yes" | "no" | null {
  const text = message.trim().toLowerCase();
  if (!text) return null;
  if (/^(כן|yes)[.!?\s]*$/i.test(text)) return "yes";
  if (/^(לא|no)[.!?\s]*$/i.test(text)) return "no";
  if (/תעביר|העבר|יועץ|consultant|human|person|escalate/.test(text)) return "yes";
  if (/אנסה|try again|later|אחר כך|עוד מעט/.test(text)) return "no";
  return null;
}

/** After the cool-off ends, clear the timer and reset slots that hit the try limit. */
function clearExpiredCool(state: DossierState, maxTries: number, now = new Date()): DossierState {
  const until = coolUntilOf(state.profile);
  if (!until || until.getTime() > now.getTime()) return state;
  return {
    ...state,
    profile: {
      ...state.profile,
      rejectCoolUntil: "",
      escalateOffer: escalateOfferPending(state.profile) ? "" : state.profile.escalateOffer,
    },
    slots: state.slots.map((slot) =>
      slot.failCount >= maxTries ? { ...slot, failCount: 0 } : slot,
    ),
  };
}

function startRejectCool(
  state: DossierState,
  minutes: number,
  now = new Date(),
): DossierState {
  return {
    ...state,
    status: state.status === "blocked" ? "gathering" : state.status,
    profile: {
      ...state.profile,
      rejectCoolUntil: new Date(now.getTime() + minutes * 60_000).toISOString(),
      escalateOffer: "pending",
    },
  };
}

function readableList(values: string[], lang: "en" | "he"): string {
  if (values.length < 2) return values[0] ?? "";
  const last = values.at(-1) ?? "";
  return `${values.slice(0, -1).join(", ")}${lang === "he" ? " ו-" : " and "}${last}`;
}

function monthList(values: string[], lang: "en" | "he", now = new Date()): string {
  return readableList(values.map((month) => formatStatementMonth(month, lang, now)), lang);
}

/**
 * One sentence that names what failed. Used instead of the generic reason
 * when the generic wording would hide the missing name or the wrong month.
 */
export function customerRejection(opts: {
  reason: string;
  field?: string;
  docType: string;
  fields: Record<string, unknown>;
  lang: "en" | "he";
  now?: Date;
}): string | undefined {
  const now = opts.now ?? new Date();
  const payslip = opts.docType === "payslip";
  const needed = priorCalendarMonths(now).map((month) => formatStatementMonth(month, opts.lang, now));
  const need = opts.lang === "he"
    ? needed.length < 2
      ? needed[0] ?? ""
      : `${needed.slice(0, -1).join(", ")} ו${needed.at(-1)}`
    : monthList(priorCalendarMonths(now), opts.lang, now);
  if (opts.reason === "unrecognized") {
    if (payslip) {
      return opts.lang === "he"
        ? `זה לא נראה כמו תלוש שכר. אשמח לתלושי שכר של ${need}`
        : `This doesn't look like a payslip. Please send payslips for ${need}`;
    }
    if (opts.docType === "id_card" || opts.docType === "id_card_back") {
      return opts.lang === "he"
        ? "לא זיהיתי את הקובץ. שלח בבקשה תמונה ברורה של הצד הקדמי, כך שהשם והמספר נראים"
        : "I couldn't tell what this file is. Please send a clear photo of the front, with the name and number visible";
    }
    return opts.lang === "he"
      ? "לא זיהיתי את הקובץ כמסמך שביקשתי"
      : "I couldn't tell what this file is";
  }
  if (!payslip) return undefined;
  const found = monthsIn(opts.fields.periodEnd ?? opts.fields.payMonths);
  const recent = recentPayslipMonths(found.join(","), 3, now);
  if (found.length && recent.length === 0) {
    const listed = opts.lang === "he"
      ? found.map((month) => formatStatementMonth(month, "he", now)).join(", ")
      : monthList(found, opts.lang, now);
    return opts.lang === "he"
      ? `התלוש הוא לחודש ${listed}. אשמח לתלושי שכר של ${need}`
      : `This payslip is for ${listed}. Please send payslips for ${need}`;
  }
  if (opts.reason === "field_present" && opts.field === "fullName" && !found.length) {
    return opts.lang === "he"
      ? `לא הצלחתי לקרוא את שם העובד ואת חודש השכר. אשמח לתלושי שכר של ${need}`
      : `I couldn't read the employee name or the pay month. Please send payslips for ${need}`;
  }
  if (opts.reason === "field_present" && opts.field === "fullName") {
    return opts.lang === "he"
      ? "לא הצלחתי לקרוא את שם העובד בתלוש"
      : "I couldn't read the employee name on the payslip";
  }
  if (opts.reason === "field_present") {
    return opts.lang === "he"
      ? `לא הצלחתי לקרוא לאיזה חודש התלוש שייך. אשמח לתלוש של ${need}`
      : `I couldn't read which month this payslip is for. Please send one for ${need}`;
  }
  if (opts.reason === "date_within_months") {
    return opts.lang === "he"
      ? `התאריך שמופיע בתלוש לא נמצא ב-3 החודשים האחרונים. אשמח לתלושי שכר של ${need}`
      : `The date on this payslip is not within the last 3 months. Please send payslips for ${need}`;
  }
  return undefined;
}

/** Explain the observed file detail without exposing internal document-type ids. */
export function rejectionDetail(opts: {
  reason: string;
  fields: Record<string, unknown>;
  lang: "en" | "he";
  expectedMonths?: string[];
  now?: Date;
}): string | undefined {
  if (opts.reason === "wrong_type") {
    return opts.lang === "he"
      ? "הקובץ לא זוהה כאחד מהמסמכים שחסרים כרגע בתיק."
      : "The file wasn't identified as one of the documents currently needed.";
  }
  if (opts.reason !== "prior_calendar_months") return undefined;
  const now = opts.now ?? new Date();
  const months = monthsIn(opts.fields.months ?? opts.fields.periodEnd);
  const expected = opts.expectedMonths?.length
    ? opts.expectedMonths
    : priorCalendarMonths(now);
  const need = monthList(expected, opts.lang, now);
  if (!months.length) {
    return opts.lang === "he"
      ? `לא הצלחתי לזהות בקובץ את החודשים שהוא מכסה. נדרשים ${need}.`
      : `I couldn't identify which months the statement covers. Needed: ${need}.`;
  }
  const listed = monthList(months, opts.lang, now);
  return opts.lang === "he"
    ? `זיהיתי בקובץ את החודשים ${listed}; נדרשים ${need}.`
    : `I found ${listed} in the statement; needed: ${need}.`;
}

/**
 * Documents stay in Hebrew unless the customer actually wrote English.
 * A file name, including `IMG_2359.HEIC`, is never a reason to switch.
 */
export function documentsReplyLang(ctx: IngestTurn): "en" | "he" {
  const policy = ctx.tenant?.chatLanguage;
  if (policy === "he" || policy === "en") return policy;
  const spoken = ctx.messages
    .filter((message) => message.role === "lead" && !isAttachmentCaption(message.text))
    .map((message) => message.text);
  const english = spoken.some((text) => explicitReplyLanguage(text) === "en");
  if (!english) return "he";
  return stickyReplyLanguage(undefined, spoken);
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
  ctx: IngestTurn;
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

function freshSlot(slot: Slot): SlotState {
  return { ...slot, status: "missing", failCount: 0, lastReason: "", remoteId: "", filename: "" };
}

/** Keep uploaded rows, drop missing rows the facts no longer ask for, add the new ones. */
function mergeSlots(previous: SlotState[], next: Slot[]): SlotState[] {
  const nextIds = new Set(next.map((slot) => slot.id));
  const previousById = new Map(previous.map((slot) => [slot.id, slot]));
  const merged = next.map((slot) => {
    const previous = previousById.get(slot.id);
    const fresh = freshSlot(slot);
    if (!previous) return fresh;
    return {
      ...fresh,
      status: previous.status,
      failCount: previous.failCount,
      lastReason: previous.lastReason,
      remoteId: previous.remoteId,
      filename: previous.filename,
      ...(previous.coveredMonths?.length ? { coveredMonths: previous.coveredMonths } : {}),
    };
  });
  for (const slot of previous) {
    if (slot.status === "uploaded" && !nextIds.has(slot.id)) merged.push(slot);
  }
  return merged;
}

function refreshDossier(state: DossierState, rules: RulesDocument, text: string, bare = false): DossierState {
  const applied = applyCustomerAnswers(state.profile, text, new Date(), { bare });
  const profile = applied.profile;
  const next = checklistSlots(profile, rules);
  const slots = mergeSlots(state.slots, next);
  const shape = (slot: SlotState) =>
    `${slot.id}|${slot.status}|${slot.collectionStage ?? ""}|${(slot.months ?? []).join(",")}|${(slot.coveredMonths ?? []).join(",")}`;
  const same =
    !applied.changed &&
    slots.length === state.slots.length &&
    slots.every((slot, index) => shape(slot) === shape(state.slots[index] ?? slot));
  const loanSlots = slots.filter((slot) => slot.docType === "loan_balances");
  const loansFilled = loanSlots.length > 0 && loanSlots.every((slot) => slot.status === "uploaded");
  let withLoans = profile;
  if (loansFilled && profile.loanMore !== "no") withLoans = { ...profile, loanMore: "pending" };
  else if (!loansFilled && profile.loanMore === "pending") withLoans = { ...profile, loanMore: "" };
  const waitingForLoan = loansFilled && withLoans.loanMore === "pending";
  const done = dossierDone(slots) && !waitingForLoan;
  const loansSame = withLoans.loanMore === state.profile.loanMore;
  if (same && loansSame) return { ...state, profile: withLoans };
  return {
    ...state,
    profile: withLoans,
    slots,
    status: done ? "complete" : "gathering",
    activeStage: activeStageOf(slots),
  };
}

type DocumentChat = ReturnType<typeof copyFor>["chat"];

function questionWho(profile: Profile, question: OpenQuestion, lang: "en" | "he"): string {
  if (!("slot" in question)) return "";
  return borrowerFileWho(profile, question.slot, lang);
}

function withBorrower(
  chat: DocumentChat,
  line: string,
  profile: Profile,
  borrower: string | undefined,
  lang: "en" | "he",
): string {
  const who = borrowerFileWho(profile, borrower, lang);
  return who ? chat.documents.forBorrower(line, who) : line;
}

/** The sentence for one checklist question. */
export function documentAskText(
  question: OpenQuestion,
  lang: "en" | "he",
  chat: DocumentChat,
  who = "",
): string {
  if (question.kind === "second_borrower") return chat.documents.askSecondBorrower;
  if (question.kind === "couple_split") return chat.documents.askCouple;
  if (question.kind === "id_biometric") return chat.documents.askIdBiometric(question.name || who);
  if (question.kind === "id_back") {
    return who ? chat.documents.forBorrower(chat.documents.askIdBack, who) : chat.documents.askIdBack;
  }
  const fallback =
    "slot" in question && question.slot === "2"
      ? lang === "he"
        ? "הלווה הנוסף"
        : "the other borrower"
      : lang === "he"
        ? "הלווה"
        : "the borrower";
  const name = "name" in question && question.name ? question.name : fallback;
  if (question.kind === "employment") return chat.documents.askEmployment(name);
  if (question.kind === "salary_deposit") return chat.documents.askSalaryDeposit(name);
  if (question.kind === "first_home") return chat.documents.askFirstHome;
  if (question.kind === "loans") return chat.documents.askLoans;
  if (question.kind === "more_loans") return chat.documents.askMoreLoans;
  if (question.kind === "more_photos") return chat.documents.askMorePhotos;
  return chat.documents.askAccounts;
}

/** A bare כן/לא counts only after the agent actually asked that question. */
function bareAnswerAllowed(profile: Profile, askedText: string): boolean {
  const question = nextQuestion(profile);
  if (!question || !askedText.trim()) return false;
  const he = documentAskText(question, "he", copyFor("he").chat, questionWho(profile, question, "he"));
  const en = documentAskText(question, "en", copyFor("en").chat, questionWho(profile, question, "en"));
  return askedText.includes(he) || askedText.includes(en);
}

function customerReply(ctx: IngestTurn, reply: string): string {
  const text = reply.trim();
  if (!text || hasAgentReplied(ctx)) return text;
  return withFirstMessageIntro(ctx, documentsReplyLang(ctx), text);
}

export function documentFileAsk(
  state: DossierState,
  rules: RulesDocument,
  lang: "en" | "he",
  chat: DocumentChat,
): string {
  const slot = state.slots.find((item) => isOutstanding(item, state.slots));
  if (!slot) return "";
  const line = slot.docType === "id_card"
    ? chat.documents.askIdCard
    : slot.docType === "payslip"
      ? chat.documents.askPayslips
      : chat.documents.askStage(slotDisplayLabel(rules, slot, lang));
  return withBorrower(chat, line, state.profile, slot.borrower, lang);
}

function gatheringLines(state: DossierState, rules: RulesDocument, lang: "en" | "he", chat: DocumentChat): string[] {
  const question = nextQuestion(state.profile);
  if (question) return [documentAskText(question, lang, chat, questionWho(state.profile, question, lang))];
  const lines: string[] = [];
  const flag = typeof state.profile.advisorFlag === "string" ? state.profile.advisorFlag : "";
  if (flag) lines.push(chat.documents.advisorFlag(flag));
  const next = documentFileAsk(state, rules, lang, chat);
  if (next) lines.push(next);
  return lines;
}

function factSnapshot(profile: Profile, documentOpen: boolean): FactSnapshot {
  const people = borrowersOf(profile);
  const first = people.find((borrower) => borrower.slot === "1") ?? people[0];
  const couple = profile.coupleSplit;
  const deposit = first?.salaryDeposit;
  return {
    loans: loansOf(profile),
    employment: first?.employment ?? "unknown",
    employmentSource: first?.employmentSource ?? "",
    secondBorrower: secondBorrowerOf(profile),
    firstHome: firstHomeOf(profile),
    coupleSplit: couple === "yes" || couple === "no" ? couple : "unknown",
    salaryDeposit: deposit === "yes" || deposit === "no" ? deposit : "",
    loanMore: typeof profile.loanMore === "string" ? profile.loanMore : "",
    openQuestion: nextQuestion(profile)?.kind ?? "",
    documentOpen,
  };
}

function confirmChangeLines(intents: CustomerIntent[], chat: ReturnType<typeof copyFor>["chat"]): string[] {
  return intents.map((intent) => {
    if (intent.kind === "retract") return chat.documents.confirmChange("retract", intent.target);
    if (intent.kind === "fact") return chat.documents.confirmChange(intent.fact, intent.value);
    if (intent.kind === "how_to") return chat.documents.confirmChange("how_to");
    return chat.documents.confirmChange("answer", intent.value);
  });
}

function checklistReviewSummary(profile: Profile): string {
  const base = "המסמכים התקבלו. לבדוק את התיק ואז לשחרר את השלב הבא.";
  const conflict = typeof profile.employmentConflict === "string" ? profile.employmentConflict.trim() : "";
  return conflict ? `${base} ${conflict}` : base;
}

/** One needs-you task when the checklist is finished, so the advisor can review and release the next step. */
async function openChecklistReview(ctx: IngestTurn, state: DossierState): Promise<DossierState> {
  if (state.profile.checklistReviewOpened === true) return state;
  const existing = await prisma.hitlTask.findFirst({
    where: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversation.id,
      reason: "document_checklist_complete",
      status: "open",
    },
    select: { id: true },
  });
  if (!existing) {
    await prisma.hitlTask.create({
      data: {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversation.id,
        leadId: ctx.lead.id,
        type: "more_info",
        reason: "document_checklist_complete",
        payload: {
          summary: checklistReviewSummary(state.profile),
          kind: "checklist_complete",
        } as Prisma.InputJsonValue,
        status: "open",
      },
    });
  }
  return { ...state, profile: { ...state.profile, checklistReviewOpened: true } };
}

async function notifyAdvisor(ctx: TurnContext, state: DossierState): Promise<DossierState> {
  const reason = typeof state.profile.advisorFlag === "string" ? state.profile.advisorFlag : "";
  if (!reason || state.profile.advisorNotified === true) return state;
  await prisma.hitlTask.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversation.id,
      leadId: ctx.lead.id,
      type: "more_info",
      reason: "document_review",
      payload: { summary: reason, kind: "advisor_flag" } as Prisma.InputJsonValue,
      status: "open",
    },
  });
  return { ...state, profile: { ...state.profile, advisorNotified: true } };
}

function offeredForms(profile: Profile): string[] {
  const raw = profile.formsOffered;
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

function rememberOfferedForm(state: DossierState, docType: string): DossierState {
  const formsOffered = [...new Set([...offeredForms(state.profile), docType])];
  return { ...state, profile: { ...state.profile, formPending: docType, formsOffered } };
}

function zernioIds(ctx: IngestTurn): { accountId: string; conversationId: string } | null {
  const conversationId =
    typeof ctx.lead.fields.zernioConversationId === "string" ? ctx.lead.fields.zernioConversationId.trim() : "";
  const accountId = ctx.connection?.zernioAccountId?.trim() ?? "";
  if (!accountId || !conversationId) return null;
  return { accountId, conversationId };
}

/** One blank PDF per conversation. The next customer file fills that slot, without a field check. */
async function sendBlankForm(
  ctx: IngestTurn,
  chat: ReturnType<typeof copyFor>["chat"],
  docType: string,
  form: BlankFormDef,
  label: string,
): Promise<"sent" | "already" | "skipped" | "missing"> {
  const prior = await prisma.message.findFirst({
    where: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversation.id,
      role: "agent",
      metadata: { path: ["documentsForm"], equals: docType },
    },
    select: { id: true },
  });
  const marker = `type=${encodeURIComponent(docType)}`;
  const inThread = ctx.messages.some((message) =>
    (message.role === "agent" || message.role === "human") && message.text.includes(marker),
  );
  if (prior || inThread) return "already";
  const caption = chat.documents.blankForm(label);
  const target = zernioIds(ctx);
  if (!target) {
    warnDocuments("documents.form_skipped", { conversationId: ctx.conversation.id, reason: "no_channel", form: docType });
    return "skipped";
  }
  const filePath = blankFormFilePath(form.file);
  if (!filePath) {
    warnDocuments("documents.form_skipped", { conversationId: ctx.conversation.id, reason: "missing_file", form: docType });
    return "missing";
  }
  const providerMessageId = `out-form-${docType}-${ctx.conversation.id}`;
  await prisma.message.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversation.id,
      role: "agent",
      text: caption,
      providerMessageId,
      metadata: { documentsForm: docType, filename: form.file } as Prisma.InputJsonValue,
    },
  });
  try {
    const bytes = await readFile(filePath);
    await sendZernioInboxMessage({
      accountId: target.accountId,
      conversationId: target.conversationId,
      text: caption,
      file: { filename: form.file, mime: "application/pdf", bytes },
    });
  } catch (err) {
    await prisma.message.deleteMany({ where: { tenantId: ctx.tenantId, providerMessageId } });
    const missing = typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
    if (missing) {
      warnDocuments("documents.form_skipped", { conversationId: ctx.conversation.id, reason: "missing_file", form: docType });
      return "missing";
    }
    throw err;
  }
  return "sent";
}

/** The blank form for this file is already in the checklist, so a second copy is not read again. */
export function blankFormAlreadyUploaded(
  rules: RulesDocument,
  slots: { docType: string; status: string }[],
  filename: string,
): boolean {
  const docType = Object.entries(rules.documents).find(([, def]) => def.blankForm?.file === filename)?.[0];
  return Boolean(docType && slots.some((slot) => slot.docType === docType && slot.status === "uploaded"));
}

async function recordFileOutcome(opts: {
  ctx: IngestTurn;
  row: DossierRow;
  job: IngestJob;
  status: "rejected" | "uploaded";
  docType: string;
  remoteId?: string;
  validation: Prisma.InputJsonValue;
}): Promise<void> {
  const data = {
    status: opts.status,
    docType: opts.docType,
    remoteId: opts.remoteId ?? "",
    bytesEnc: null,
    validation: opts.validation,
  };
  if (opts.job.id) {
    await prisma.leadDocument.update({ where: { id: opts.job.id }, data });
    return;
  }
  await prisma.leadDocument.create({
    data: {
      tenantId: opts.ctx.tenantId,
      leadId: opts.ctx.lead.id,
      dossierId: opts.row.id,
      messageId: opts.job.messageId,
      filename: opts.job.filename,
      mime: opts.job.mime,
      ...data,
    },
  });
}

/** A second copy of a form that already filled its slot. No model read and no customer line. */
async function closeDuplicateBlankForm(opts: {
  ctx: IngestTurn;
  row: DossierRow;
  state: DossierState;
  job: IngestJob;
  rules: RulesDocument;
}): Promise<boolean> {
  if (!blankFormAlreadyUploaded(opts.rules, opts.state.slots, opts.job.filename)) return false;
  const slot = opts.state.slots.find((item) =>
    item.status === "uploaded" && opts.rules.documents[item.docType]?.blankForm?.file === opts.job.filename,
  );
  await recordFileOutcome({
    ctx: opts.ctx,
    row: opts.row,
    job: opts.job,
    status: "uploaded",
    docType: slot?.docType ?? "",
    remoteId: slot?.remoteId,
    validation: { duplicateOf: slot?.id ?? "" },
  });
  return true;
}

/** A form already handed to this chat. The next file fills that slot. */
function offeredBlankForm(
  state: DossierState,
  rules: RulesDocument,
  messages: { role: string; text: string }[],
): string {
  const pending = typeof state.profile.formPending === "string" ? state.profile.formPending : "";
  if (pending) return pending;
  for (const slot of state.slots) {
    if (slot.status === "uploaded" || !rules.documents[slot.docType]?.blankForm) continue;
    const marker = `type=${encodeURIComponent(slot.docType)}`;
    const offered = messages.some((message) =>
      (message.role === "agent" || message.role === "human") && message.text.includes(marker),
    );
    if (offered) return slot.docType;
  }
  return "";
}

/** A blank form was just sent, so the next file fills that type unless the reader names another open type. */
function assumePendingForm(
  state: DossierState,
  extractedType: string,
): { state: DossierState; accepted: { slotId: string; docType: string } | null } | null {
  const pending = typeof state.profile.formPending === "string" ? state.profile.formPending : "";
  if (!pending) return null;
  const slot = state.slots.find((item) => item.status === "missing" && item.docType === pending);
  const namedOther = Boolean(
    extractedType &&
      extractedType !== pending &&
      state.slots.some((item) => item.status === "missing" && item.docType === extractedType),
  );
  const next = { ...state, profile: { ...state.profile, formPending: "" } };
  if (!slot || namedOther) return { state: next, accepted: null };
  return { state: next, accepted: { slotId: slot.id, docType: pending } };
}

function offlineSmartClient(): SmartClient {
  return {
    async findClient() {
      return {
        clientId: "test",
        profile: factsFromClient({}),
      };
    },
    async listClients() {
      return [];
    },
    async upload() {
      throw new Error("test_mode");
    },
  };
}

function uploadNameFor(state: DossierState, rules: RulesDocument, slotId: string, docType: string, now = new Date()): string {
  const slot = state.slots.find((item) => item.id === slotId);
  const borrower = borrowersOf(state.profile).find((item) => item.slot === slot?.borrower);
  const label = rules.documents[docType]?.labels.he ?? docType;
  const dated = slot?.year ? `${label} ${slot.year}` : label;
  const date = uploadDay(now);
  const borrowerName = borrower?.fullName || "לווה";
  const used = new Set(state.slots.map((item) => item.filename));
  let version = 1;
  let name = smartUploadName({ borrowerName, docLabel: dated, date, version });
  while (used.has(name)) {
    version += 1;
    name = smartUploadName({ borrowerName, docLabel: dated, date, version });
  }
  return name;
}

/** Find the Smart NPV client, or leave the dossier on needs_id. */
async function matchClient(opts: IngestLines & {
  config: DocumentConfig;
  client: SmartClient;
  lang: "en" | "he";
  row: DossierRow | null;
  typedId: string;
  hasFiles: boolean;
  answerText: string;
  bare: boolean;
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
  const answered = applyCustomerAnswers(found.profile, opts.answerText, new Date(), { bare: opts.bare });
  const opened = freshDossier({
    smartClientId: found.clientId,
    profile: answered.profile,
    slots: checklistSlots(answered.profile, opts.config.rules),
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
    if (validation.held === true) continue;
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
      await markRejected({
        tenantId: opts.ctx.tenantId,
        leadId: opts.ctx.lead.id,
        dossierId: opts.row.id,
        messageId: file.messageId,
        filename: attachment.filename,
        mime: attachment.mime,
        reason,
      });
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
}): Promise<{
  state: DossierState;
  cooled: boolean;
  accepted: {
    slotId: string;
    docType: string;
    coveredMonths?: string[];
    biometric?: "yes" | "no";
    appendix?: "yes" | "no";
    payMonths?: string[];
  } | null;
}> {
  if (opts.job.resume) {
    return {
      state: opts.state,
      cooled: false,
      accepted: { slotId: opts.job.resume.slotId, docType: opts.job.resume.docType },
    };
  }
  const missing = opts.state.slots.filter((slot) => slot.status === "missing");
  const open = missing.map((slot) => {
    const he = docLabel(opts.config.rules, slot.docType, "he");
    const en = docLabel(opts.config.rules, slot.docType, "en");
    return {
      docType: slot.docType,
      label: he === en ? he : `${he} / ${en}`,
      fields: opts.config.rules.documents[slot.docType]?.fields ?? [],
      recognize: opts.config.rules.documents[slot.docType]?.recognize,
    };
  });
  const extracted: DocExtraction = await opts.extract({
    bytes: opts.job.bytes,
    mime: opts.job.mime,
    filename: opts.job.filename,
    open,
    focus: missing[0]?.docType,
  });
  let working = opts.state;
  const assumed = assumePendingForm(working, extracted.docType ?? "");
  if (assumed?.accepted) return { state: assumed.state, cooled: false, accepted: assumed.accepted };
  if (assumed) working = assumed.state;
  const judged = judgeFile(working, opts.config.rules, extracted, new Date(), {
    maxTries: opts.config.maxRejectTries ?? DEFAULT_MAX_REJECT_TRIES,
  });
  if (judged.kind === "unplaced") {
    const slot = working.slots.find((item) =>
      item.docType === extracted.docType && item.status === "missing" && item.year,
    );
    const label = docLabel(opts.config.rules, extracted.docType || "", opts.lang);
    const detail = slot?.year
      ? opts.lang === "he"
        ? `לא מצאתי עליו את שנת ${slot.year}`
        : `I couldn't find ${slot.year} on it`
      : opts.lang === "he"
        ? "לא הצלחתי לשייך אותו לתיק"
        : "I couldn't match it to the file";
    warnDocuments("documents.judge", {
      filename: opts.job.filename,
      kind: "unplaced",
      docType: extracted.docType || "(none)",
      detail: `Could not place "${extracted.docType || "unknown"}" on any open slot.`,
    });
    opts.lines.push(opts.chat.documents.rejected(label || opts.job.filename, detail));
    await recordFileOutcome({
      ctx: opts.ctx,
      row: opts.row,
      job: opts.job,
      status: "rejected",
      docType: extracted.docType,
      validation: { reason: "unplaced" },
    });
    return { state: judged.state, cooled: false, accepted: null };
  }
  if (judged.kind !== "reject") {
    warnDocuments("documents.judge", {
      filename: opts.job.filename,
      kind: "accept",
      slotId: judged.slotId,
      docType: judged.docType,
      detail: `Accepted as ${judged.docType} → slot ${judged.slotId}.`,
    });
    return {
      state: working,
      cooled: false,
      accepted: {
        slotId: judged.slotId,
        docType: judged.docType,
        ...(judged.coveredMonths?.length ? { coveredMonths: judged.coveredMonths } : {}),
        ...((extracted.fields.biometric === "yes" || extracted.fields.biometric === "no")
          ? { biometric: extracted.fields.biometric }
          : {}),
        ...((extracted.fields.appendix === "yes" || extracted.fields.appendix === "no")
          ? { appendix: extracted.fields.appendix }
          : {}),
        ...(judged.docType === "payslip"
          ? { payMonths: monthsIn(extracted.fields.payMonths ?? extracted.fields.periodEnd) }
          : {}),
      },
    };
  }
  const openTypes = open.map((item) => item.docType);
  const foundMonths = monthsIn(extracted.fields.months ?? extracted.fields.periodEnd);
  const expectedMonths =
    judged.reason === "prior_calendar_months" ? priorCalendarMonths(new Date()) : [];
  const judgeDetail =
    judged.reason === "wrong_type"
      ? `Rejected: file looks like "${extracted.docType || "unknown"}", but open slot is ${judged.slotId || openTypes.join(", ") || "none"} (${openTypes.join(", ") || "no open types"}).`
      : judged.reason === "prior_calendar_months"
        ? foundMonths.length
          ? `Rejected bank statement: vision found months [${foundMonths.join(", ")}], but we need the three prior months [${expectedMonths.join(", ")}].`
          : `Rejected bank statement: vision returned empty months (need [${expectedMonths.join(", ")}]). The file was typed as a statement, but no YYYY-MM coverage was extracted.`
      : judged.reason === "field_present" || judged.reason.startsWith("field_")
        ? `Rejected ${extracted.docType || "file"}: missing/invalid fields (${extracted.summary?.emptyFields?.join(", ") || judged.reason}).`
        : `Rejected ${extracted.docType || "file"}: ${judged.reason}.`;
  warnDocuments("documents.judge", {
    filename: opts.job.filename,
    kind: "reject",
    slotId: judged.slotId || "(none)",
    docType: extracted.docType || "(none)",
    reason: judged.reason,
    atLimit: judged.atLimit,
    openTypes,
    ...(judged.reason === "prior_calendar_months"
      ? { foundMonths, expectedMonths, rawMonthsField: extracted.fields.months ?? "" }
      : {}),
    detail: judgeDetail,
  });
  let state = judged.state;
  const slotDoc = state.slots.find((slot) => slot.id === judged.slotId)?.docType ?? extracted.docType ?? "";
  const label = docLabel(opts.config.rules, slotDoc, opts.lang);
  const specific = customerRejection({
    reason: judged.reason,
    field: judged.field,
    docType: slotDoc,
    fields: extracted.fields,
    lang: opts.lang,
  });
  const customerReason = judged.reason === "field_present" && judged.field === "nationalId"
    ? "id_number"
    : judged.reason;
  opts.lines.push(
    specific
      ? opts.chat.documents.rejected(label || opts.job.filename, specific)
      : opts.chat.documents.rejected(
          label || opts.job.filename,
          reasonText(opts.chat, customerReason),
          rejectionDetail({
            reason: judged.reason,
            fields: extracted.fields,
            lang: opts.lang,
            ...(judged.reason === "prior_calendar_months" ? { expectedMonths } : {}),
          }),
        ),
  );
  const validation = {
    reason: judged.reason,
    ...(extracted.error ? { error: extracted.error } : {}),
    ...(extracted.summary
      ? {
          extract: {
            docType: extracted.docType,
            askedFields: extracted.summary.askedFields,
            filledFields: extracted.summary.filledFields,
            emptyFields: extracted.summary.emptyFields,
            finishReason: extracted.summary.finishReason,
            ms: extracted.summary.ms,
            ...(extracted.fields.months ? { months: extracted.fields.months } : {}),
            ...(extracted.summary.evidence ? { evidence: extracted.summary.evidence } : {}),
            ...(extracted.summary.warnings?.length ? { warnings: extracted.summary.warnings } : {}),
          },
        }
      : {}),
  } as Prisma.InputJsonValue;
  if (opts.job.id) {
    await prisma.leadDocument.update({
      where: { id: opts.job.id },
      data: { status: "rejected", bytesEnc: null, validation },
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
        validation,
        bytesEnc: null,
      },
    });
  }
  if (!judged.atLimit) return { state, cooled: false, accepted: null };
  const minutes = opts.config.rejectCooldownMinutes ?? DEFAULT_REJECT_COOLDOWN_MINUTES;
  state = startRejectCool(state, minutes);
  opts.lines.push(opts.chat.documents.cooldownWait(minutes));
  opts.lines.push(opts.chat.documents.askEscalate);
  return { state, cooled: true, accepted: null };
}

async function handOffDocumentReview(opts: IngestLines & { summary: string }): Promise<void> {
  await prisma.$transaction([
    prisma.hitlTask.create({
      data: {
        tenantId: opts.ctx.tenantId,
        conversationId: opts.ctx.conversation.id,
        leadId: opts.ctx.lead.id,
        type: "more_info",
        reason: "document_review",
        payload: { summary: opts.summary },
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
}

function applyAccept(
  state: DossierState,
  slotId: string,
  remoteId: string,
  filename: string,
  covered?: string[],
): DossierState {
  const slot = state.slots.find((item) => item.id === slotId);
  if (slot?.months?.length) return recordMonths(state, slotId, covered ?? [], remoteId, filename);
  return commitSlot(state, slotId, remoteId, filename);
}

/** One compact line: the document, and the month or year when the file has one. */
function receiptName(
  rules: RulesDocument,
  lang: "en" | "he",
  state: DossierState,
  slotId: string,
  docType: string,
  covered?: string[],
): string {
  const slot = state.slots.find((item) => item.id === slotId);
  const base = docLabel(rules, docType, lang);
  const titled = covered?.length
    ? `${base} ${monthList(covered, lang)}`
    : slot?.year
      ? `${base} ${slot.year}`
      : base;
  const who = borrowerFileWho(state.profile, slot?.borrower, lang);
  return who ? copyFor(lang).chat.documents.ownedBy(titled, who) : titled;
}

/** After the front of an ID is in, ask whether that card is biometric before the next file. */
function rememberIdSide(state: DossierState, slotId: string, docType: string): DossierState {
  if (docType !== "id_card") return state;
  if (state.profile.askIdBiometric === "1" || state.profile.askIdBiometric === "2") return state;
  const who = state.slots.find((slot) => slot.id === slotId)?.borrower;
  if (who !== "1" && who !== "2") return state;
  const borrower = borrowersOf(state.profile).find((item) => item.slot === who);
  if (!borrower || borrower.idBiometric === "yes" || borrower.idBiometric === "no") return state;
  return { ...state, profile: { ...state.profile, askIdBiometric: who } };
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
  coveredMonths?: string[];
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
    opts.lines.push(opts.chat.documents.received(
      receiptName(opts.config.rules, opts.lang, state, slotId, docType, opts.coveredMonths),
    ));
    return { state: rememberIdSide(state, slotId, docType), accepted: false };
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
    const filename = uploadNameFor(state, opts.config.rules, slotId, docType);
    if (isTestLead(opts.config, phoneOf(opts.ctx))) {
      const remoteId = `local:${filename}`;
      state = applyAccept(state, slotId, remoteId, filename, opts.coveredMonths);
      await prisma.leadDocument.update({
        where: { id: docRow.id },
        data: {
          status: "uploaded",
          docType,
          filename: job.filename,
          remoteId,
          bytesEnc: encryptBytes(job.bytes),
          validation: { accepted: true, slotId, docType } as Prisma.InputJsonValue,
        },
      });
      opts.lines.push(opts.chat.documents.received(
        receiptName(opts.config.rules, opts.lang, opts.state, slotId, docType, opts.coveredMonths),
      ));
      return { state: rememberIdSide(state, slotId, docType), accepted: true };
    }
    const uploaded = await opts.client.upload({
      clientId: state.smartClientId,
      docType,
      filename,
      mime: "application/pdf",
      bytes: job.bytes,
    });
    state = applyAccept(state, slotId, uploaded.remoteId, filename, opts.coveredMonths);
    let savedUrl = "";
    if (opts.client.listUploads) {
      try {
        const listed = await opts.client.listUploads(state.smartClientId, uploadDay(new Date()));
        savedUrl = listed.find((item) => item.fileName === filename)?.downloadUrl ?? "";
      } catch (err) {
        warnDocuments("documents.upload_list_failed", {
          filename,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await prisma.leadDocument.update({
      where: { id: docRow.id },
      data: {
        status: "uploaded",
        docType,
        filename: job.filename,
        remoteId: uploaded.remoteId,
        downloadUrl: savedUrl || null,
        bytesEnc: null,
        validation: { accepted: true } as Prisma.InputJsonValue,
      },
    });
    opts.lines.push(opts.chat.documents.received(
      receiptName(opts.config.rules, opts.lang, opts.state, slotId, docType, opts.coveredMonths),
    ));
    return { state: rememberIdSide(state, slotId, docType), accepted: true };
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

async function holdImage(opts: IngestLines & {
  row: DossierRow;
  job: IngestJob;
  slotId: string;
  docType: string;
}): Promise<void> {
  await prisma.leadDocument.create({
    data: {
      tenantId: opts.ctx.tenantId,
      leadId: opts.ctx.lead.id,
      dossierId: opts.row.id,
      messageId: opts.job.messageId,
      filename: opts.job.filename,
      mime: opts.job.mime,
      docType: opts.docType,
      status: "stored",
      validation: { held: true, slotId: opts.slotId, docType: opts.docType } as Prisma.InputJsonValue,
      bytesEnc: encryptBytes(opts.job.bytes),
    },
  });
}

/** The saved file the customer sent most recently, not the last row in the checklist. */
async function newestUploadedSlotId(
  tenantId: string,
  dossierId: string,
  state: DossierState,
): Promise<string> {
  const docs = await prisma.leadDocument.findMany({
    where: { tenantId, dossierId, status: "uploaded" },
    orderBy: { createdAt: "desc" },
    select: { validation: true },
  });
  const open = new Set(state.slots.filter((slot) => slot.status === "uploaded").map((slot) => slot.id));
  for (const doc of docs) {
    const validation = isRecord(doc.validation) ? doc.validation : {};
    const slotId = typeof validation.slotId === "string" ? validation.slotId : "";
    if (slotId && open.has(slotId)) return slotId;
  }
  return "";
}

async function dropHeld(tenantId: string, dossierId: string, slotId: string): Promise<void> {
  const held = await prisma.leadDocument.findMany({
    where: { tenantId, dossierId, status: "stored" },
    select: { id: true, validation: true },
  });
  for (const doc of held) {
    const validation = isRecord(doc.validation) ? doc.validation : {};
    if (validation.held !== true || validation.slotId !== slotId) continue;
    await prisma.leadDocument.update({
      where: { id: doc.id },
      data: { status: "rejected", bytesEnc: null, validation: { merged: false, reason: "replaced" } },
    });
  }
}

function backPendingOf(profile: Profile): "1" | "2" | "" {
  return profile.idBackPending === "1" || profile.idBackPending === "2" ? profile.idBackPending : "";
}

/** A biometric reading on the card opens the other side for that borrower. */
function noteIdBiometric(
  state: DossierState,
  rules: RulesDocument,
  slotId: string,
  biometric: "yes" | "no" | undefined,
): DossierState {
  if (biometric !== "yes" && biometric !== "no") return state;
  const who = state.slots.find((slot) => slot.id === slotId)?.borrower;
  if (who !== "1" && who !== "2") return state;
  const profile = applyExtractedBiometric(state.profile, who, biometric);
  return refreshDossier({ ...state, profile }, rules, "");
}

/** The ספח was already in the ID photo, so that slot is the same file. */
function noteAppendix(
  state: DossierState,
  slotId: string,
  appendix: "yes" | "no" | undefined,
): DossierState {
  if (appendix !== "yes") return state;
  const who = state.slots.find((slot) => slot.id === slotId)?.borrower;
  if (who !== "1" && who !== "2") return state;
  return { ...state, profile: { ...state.profile, appendixSeen: who } };
}

/** The ספח in the ID photo shares the file that uploaded the card. */
function commitSeenAppendix(state: DossierState, frontSlotId: string): DossierState {
  const front = state.slots.find((slot) => slot.id === frontSlotId);
  if (!front || front.status !== "uploaded") return state;
  if (state.profile.appendixSeen !== front.borrower) return state;
  const appendix = state.slots.find((slot) =>
    slot.docType === "id_appendix" && slot.borrower === front.borrower && slot.status !== "uploaded",
  );
  if (!appendix) return state;
  return commitSlot(state, appendix.id, front.remoteId, front.filename || "photos.pdf");
}

/** The other side of the ID is the back of the card. The front, sent again, is not. */
export function acceptsIdBack(docType: string): boolean {
  return docType === "id_card_back";
}

export type IdBackRead = { accept: boolean; docType: string; unread?: "no_model" | "extract_failed" };

/** A failed read is not the same as a photo the model could see and reject. */
export function idBackOutcome(read: IdBackRead): "accept" | "wrong" | "unread" {
  if (read.unread) return "unread";
  return read.accept ? "accept" : "wrong";
}

/** Read the photo the customer sent while the other side is still open. */
export async function readIdBack(
  extract: ExtractFn,
  job: { bytes: Buffer; mime: string; filename: string },
  recognize?: string,
): Promise<IdBackRead> {
  const extracted = await extract({
    bytes: job.bytes,
    mime: job.mime,
    filename: job.filename,
    open: [{
      docType: "id_card_back",
      label: "הצד השני של תעודת הזהות / other side of the ID card",
      fields: [],
      recognize,
    }],
    focus: "id_card_back",
  });
  const docType = extracted.docType || "";
  return { accept: acceptsIdBack(docType), docType, ...(extracted.unread ? { unread: extracted.unread } : {}) };
}

/** The uploaded slot this correction is about. The other side wins when they name it. */
export function retractionSlot(slots: SlotState[], text: string): SlotState | undefined {
  const uploaded = slots.filter((slot) => slot.status === "uploaded");
  if (/רישיון|צד (ה)?שני|other side|back of|licen[cs]e/i.test(text)) {
    return [...uploaded].reverse().find((slot) => slot.docType === "id_card_back");
  }
  return uploaded.at(-1);
}

/**
 * The photo they just sent is still open, so "the last file" is that photo.
 * A biometric reading from it is dropped with the photo.
 */
export function releaseHeldSlot(state: DossierState, rules: RulesDocument, slotId: string): DossierState {
  const slot = state.slots.find((item) => item.id === slotId);
  if (!slot || slot.status === "uploaded") {
    return { ...state, profile: { ...state.profile, imageBatchSlot: "", idBackPending: "" } };
  }
  let profile: Profile = { ...state.profile, imageBatchSlot: "", idBackPending: "" };
  const who = slot.borrower === "1" || slot.borrower === "2" ? slot.borrower : "";
  if (who) {
    const borrowers = borrowersOf(profile).map((borrower) =>
      borrower.slot === who ? { ...borrower, idBiometric: "" as const } : borrower,
    );
    profile = { ...profile, borrowers };
    if (profile.appendixSeen === who) profile = { ...profile, appendixSeen: "" };
  }
  return refreshDossier({ ...state, profile }, rules, "");
}

/** Clear the named uploaded slot and, when it was the other side, ask for it again. */
export function reopenNamedSlot(
  state: DossierState,
  target: "id_card_back" | "latest",
  latestSlotId = "",
): { state: DossierState; slot: SlotState } | null {
  const uploaded = state.slots.filter((slot) => slot.status === "uploaded");
  const slot = target === "id_card_back"
    ? [...uploaded].reverse().find((item) => item.docType === "id_card_back")
    : uploaded.find((item) => item.id === latestSlotId) ?? uploaded.at(-1);
  if (!slot) return null;
  const slots = state.slots.map((item) =>
    item.id === slot.id
      ? { ...item, status: "missing" as const, remoteId: "", filename: "", failCount: 0, lastReason: "" }
      : item,
  );
  let profile = state.profile;
  if (slot.docType === "id_card_back" && (slot.borrower === "1" || slot.borrower === "2")) {
    const front = state.slots.find((item) => item.docType === "id_card" && item.borrower === slot.borrower);
    profile = { ...profile, idBackPending: slot.borrower, imageBatchSlot: front?.id ?? "" };
  }
  const next = slots.find((item) => item.id === slot.id) ?? slot;
  return {
    state: { ...state, slots, profile, status: "gathering", activeStage: activeStageOf(slots) },
    slot: next,
  };
}

/** Clear that slot and, when it was the other side, ask for it again. */
export function reopenUploadedSlot(state: DossierState, text: string): { state: DossierState; slot: SlotState } | null {
  if (!retractsLastFile(text)) return null;
  const slot = retractionSlot(state.slots, text);
  if (!slot) return null;
  return reopenNamedSlot(state, slot.docType === "id_card_back" ? "id_card_back" : "latest");
}

/** The other side shares the PDF that already uploaded the front. */
function commitIdBack(state: DossierState, frontSlotId: string): DossierState {
  const front = state.slots.find((slot) => slot.id === frontSlotId);
  if (!front || front.status !== "uploaded") return state;
  const back = state.slots.find((slot) =>
    slot.docType === "id_card_back" && slot.borrower === front.borrower && slot.status !== "uploaded",
  );
  if (!back) return state;
  return commitSlot(state, back.id, front.remoteId, front.filename || "photos.pdf");
}

async function heldForSlot(tenantId: string, dossierId: string, slotId: string): Promise<number> {
  const held = await prisma.leadDocument.findMany({
    where: { tenantId, dossierId, status: "stored" },
    select: { validation: true },
  });
  return held.filter((doc) => {
    const validation = isRecord(doc.validation) ? doc.validation : {};
    return validation.held === true && validation.slotId === slotId;
  }).length;
}

/** Photos of one document become a single PDF, then that PDF is what Smart NPV receives. */
async function closeImageBatch(opts: IngestLines & {
  config: DocumentConfig;
  client: SmartClient;
  lang: "en" | "he";
  row: DossierRow;
  state: DossierState;
}): Promise<DossierState> {
  const slotId = typeof opts.state.profile.imageBatchSlot === "string" ? opts.state.profile.imageBatchSlot : "";
  if (!slotId) return opts.state;
  const held = await prisma.leadDocument.findMany({
    where: { tenantId: opts.ctx.tenantId, dossierId: opts.row.id, status: "stored" },
    orderBy: { createdAt: "asc" },
  });
  const pages: { id: string; mime: string; bytes: Buffer; messageId: string | null }[] = [];
  for (const doc of held) {
    const validation = isRecord(doc.validation) ? doc.validation : {};
    if (validation.held !== true || validation.slotId !== slotId || !doc.bytesEnc) continue;
    pages.push({
      id: doc.id,
      mime: doc.mime,
      bytes: decryptBytes(doc.bytesEnc),
      messageId: doc.messageId,
    });
  }
  if (!pages.length) return { ...opts.state, profile: { ...opts.state.profile, imageBatchSlot: "" } };
  const slot = opts.state.slots.find((item) => item.id === slotId);
  const pdf = await filesToPdf(pages.map((page) => ({ mime: page.mime, bytes: page.bytes })));
  const uploaded = await uploadAcceptedFile({
    ...opts,
    state: opts.state,
    job: {
      messageId: pages[pages.length - 1]?.messageId ?? "",
      filename: "photos.pdf",
      mime: "application/pdf",
      bytes: pdf,
    },
    slotId,
    docType: slot?.docType ?? "",
  });
  if (!uploaded.accepted) return opts.state;
  let next = { ...uploaded.state, profile: { ...uploaded.state.profile, imageBatchSlot: "" } };
  if (slot?.docType === "id_card") next = commitSeenAppendix(next, slotId);
  await prisma.$transaction(
    pages.map((page) =>
      prisma.leadDocument.update({
        where: { id: page.id },
        data: { status: "rejected", bytesEnc: null, validation: { merged: true } },
      }),
    ),
  );
  return next;
}

export async function runDocumentsIngest(
  ctx: IngestTurn,
  deps?: { extract?: ExtractFn; client?: SmartClient; readTurn?: typeof readCustomerTurn },
): Promise<{ ok: boolean; reply: string }> {
  const config = await readConfig(ctx.tenantId);
  const lang = documentsReplyLang(ctx);
  const chat = copyFor(lang, { gender: ctx.agent.persona?.gender }).chat;
  if (!config) return { ok: false, reply: customerReply(ctx, chat.documents.notConfigured) };

  const testing = isTestLead(config, phoneOf(ctx));
  const client = deps?.client ?? (testing
    ? offlineSmartClient()
    : smartClientFor({ baseUrl: config.baseUrl, apiKey: documentApiKey(config) }));
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
  if (rejectedTypes) return { ...rejectedTypes, reply: customerReply(ctx, rejectedTypes.reply) };

  const lastAgentText =
    [...ctx.messages].reverse().find((message) => message.role === "agent" || message.role === "human")?.text ?? "";
  const bare = row ? bareAnswerAllowed(stateOf(row).profile, lastAgentText) : false;
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
    answerText: inbound.newestText,
    bare,
  });
  if (matched.done) return { ...matched.done, reply: customerReply(ctx, matched.done.reply) };
  row = matched.row;
  if (!row) return { ok: false, reply: customerReply(ctx, chat.documents.notConfigured) };

  const backPending = stateOf(row).profile.idBackPending === "1" || stateOf(row).profile.idBackPending === "2";
  const closingPhotos = Boolean(stateOf(row).profile.imageBatchSlot && photoDone(inbound.newestText) && !backPending);
  const maxTries = config.maxRejectTries ?? DEFAULT_MAX_REJECT_TRIES;
  const answerText = closingPhotos ? "" : inbound.newestText;
  const prior = stateOf(row);
  const documentOpen = prior.slots.some((slot) => isOutstanding(slot, prior.slots));
  let turnIntents: CustomerIntent[] = [];
  let held = false;
  let refreshText = answerText;
  let profileForRefresh = prior.profile;
  if (answerText && !inbound.files.length) {
    const pending = pendingTurnOf(prior.profile);
    const confirmation = pending ? confirmAnswer(answerText) : null;
    if (pending && confirmation === "yes") {
      turnIntents = pending;
      profileForRefresh = clearPendingTurn(prior.profile);
      refreshText = "";
    } else if (pending && confirmation === "no") {
      profileForRefresh = clearPendingTurn(prior.profile);
      refreshText = "";
    } else {
      const base = pending ? clearPendingTurn(prior.profile) : prior.profile;
      const snapshot = factSnapshot(base, documentOpen);
      const read = await (deps?.readTurn ?? readCustomerTurn)({
        message: answerText,
        snapshot,
        lastAgentMessage: lastAgentText,
        openSlot: prior.slots.find((slot) => isOutstanding(slot, prior.slots))?.docType ?? "",
      });
      if (proposalNeedsConfirm(snapshot, read.intents)) {
        held = true;
        profileForRefresh = withPendingTurn(base, read.intents);
        refreshText = "";
        lines.push(chat.documents.confirmTurn(confirmChangeLines(read.intents, chat)));
      } else {
        turnIntents = read.intents;
        profileForRefresh = clearPendingTurn(base);
      }
    }
  }
  const applied = applyTurnFacts(profileForRefresh, turnIntents);
  profileForRefresh = applied.profile;
  for (const revision of applied.revisions) lines.push(chat.documents.revised(revision.kind, revision.detail));
  if (applied.loansCleared) lines.push(chat.documents.noLoans);
  let state = clearExpiredCool(
    refreshDossier({ ...prior, profile: profileForRefresh }, config.rules, refreshText, bare),
    maxTries,
  );
  const offeredForm = offeredBlankForm(state, config.rules, ctx.messages);
  if (offeredForm && state.profile.formPending !== offeredForm) {
    state = { ...state, profile: { ...state.profile, formPending: offeredForm } };
  }
  if (held) {
    await prisma.dossier.update({
      where: { id: row.id },
      data: {
        status: "gathering",
        slots: state.slots as unknown as Prisma.InputJsonValue,
        activeStage: state.activeStage,
        profile: state.profile as Prisma.InputJsonValue,
        smartClientId: state.smartClientId,
      },
    });
    await safeRefreshLeadState(ctx.tenantId, ctx.lead.id);
    return { ok: true, reply: customerReply(ctx, lines.filter(Boolean).join("\n")) };
  }
  if (factsOpen(state.profile)) {
    lines.push(...gatheringLines(state, config.rules, lang, chat));
    await prisma.dossier.update({
      where: { id: row.id },
      data: {
        status: "gathering",
        slots: state.slots as unknown as Prisma.InputJsonValue,
        activeStage: state.activeStage,
        profile: state.profile as Prisma.InputJsonValue,
        smartClientId: state.smartClientId,
      },
    });
    await safeRefreshLeadState(ctx.tenantId, ctx.lead.id);
    return { ok: true, reply: customerReply(ctx, lines.filter(Boolean).join("\n")) };
  }
  if (closingPhotos) {
    state = await closeImageBatch({ ctx, chat, lines, config, client, lang, row, state });
    state = refreshDossier(state, config.rules, "");
  }
  state = await notifyAdvisor(ctx, state);

  if (escalateOfferPending(state.profile)) {
    const answer = escalateAnswer(inbound.newestText);
    if (answer === "yes") {
      state = {
        ...state,
        profile: { ...state.profile, escalateOffer: "accepted", rejectCoolUntil: "" },
      };
      await handOffDocumentReview({
        ctx,
        chat,
        lines,
        summary: "customer asked to escalate document review",
      });
      lines.push(chat.documents.escalateAccepted);
      await prisma.dossier.update({
        where: { id: row.id },
        data: {
          status: state.status === "blocked" ? "gathering" : state.status,
          slots: state.slots as unknown as Prisma.InputJsonValue,
          activeStage: state.activeStage,
          profile: state.profile as Prisma.InputJsonValue,
          smartClientId: state.smartClientId,
        },
      });
      await safeRefreshLeadState(ctx.tenantId, ctx.lead.id);
      return { ok: true, reply: customerReply(ctx, lines.filter(Boolean).join("\n")) };
    }
    if (answer === "no") {
      state = { ...state, profile: { ...state.profile, escalateOffer: "declined" } };
      lines.push(chat.documents.escalateDeclined);
      if (coolActive(state.profile)) lines.push(chat.documents.cooldownWait(coolMinutesLeft(state.profile)));
    }
  }

  if (coolActive(state.profile) && inbound.files.length > 0) {
    const minutes = coolMinutesLeft(state.profile);
    lines.push(chat.documents.cooldownWait(minutes));
    if (!escalateOfferPending(state.profile) && state.profile.escalateOffer !== "accepted") {
      state = { ...state, profile: { ...state.profile, escalateOffer: "pending" } };
      lines.push(chat.documents.askEscalate);
    }
    for (const file of inbound.files) {
      await markRejected({
        tenantId: ctx.tenantId,
        leadId: ctx.lead.id,
        dossierId: row.id,
        messageId: file.messageId,
        filename: file.attachment.filename,
        mime: file.attachment.mime,
        reason: "cooldown",
      });
    }
    await prisma.dossier.update({
      where: { id: row.id },
      data: {
        status: state.status === "blocked" ? "gathering" : state.status,
        slots: state.slots as unknown as Prisma.InputJsonValue,
        activeStage: state.activeStage,
        profile: state.profile as Prisma.InputJsonValue,
        smartClientId: state.smartClientId,
      },
    });
    await safeRefreshLeadState(ctx.tenantId, ctx.lead.id);
    return { ok: true, reply: customerReply(ctx, lines.filter(Boolean).join("\n")) };
  }

  // Older dossiers may still be blocked from the previous auto-escalation path.
  if (state.status === "blocked") {
    state = { ...state, status: "gathering" };
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
    if (await closeDuplicateBlankForm({ ctx, row, state, job, rules: config.rules })) continue;
    const batchSlot = typeof state.profile.imageBatchSlot === "string" ? state.profile.imageBatchSlot : "";
    if (backPendingOf(state.profile) && batchSlot) {
      let read: IdBackRead = { accept: false, docType: "", unread: "extract_failed" };
      try {
        read = await readIdBack(extract, job, config.rules.documents.id_card_back?.recognize);
      } catch (err) {
        warnDocuments("documents.id_back_read_failed", {
          conversationId: ctx.conversation.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const outcome = idBackOutcome(read);
      if (outcome === "unread") {
        const fails = (typeof state.profile.idBackReadFails === "number" ? state.profile.idBackReadFails : 0) + 1;
        state = { ...state, profile: { ...state.profile, idBackReadFails: fails } };
        await recordFileOutcome({
          ctx,
          row,
          job,
          status: "rejected",
          docType: "id_card_back",
          validation: { reason: read.unread ?? "extract_failed" },
        });
        if (fails >= maxTries) {
          const minutes = config.rejectCooldownMinutes ?? DEFAULT_REJECT_COOLDOWN_MINUTES;
          state = startRejectCool(state, minutes);
          lines.push(chat.documents.cooldownWait(minutes));
          lines.push(chat.documents.askEscalate);
        } else {
          lines.push(chat.documents.idBackTryAgain);
        }
        continue;
      }
      if (outcome === "wrong") {
        lines.push(chat.documents.notIdBack);
        await recordFileOutcome({
          ctx,
          row,
          job,
          status: "rejected",
          docType: "id_card_back",
          validation: { reason: "not_id_back", docType: read.docType },
        });
        continue;
      }
      state = { ...state, profile: { ...state.profile, idBackReadFails: 0 } };
      await holdImage({ ctx, chat, lines, row, job, slotId: batchSlot, docType: "id_card" });
      const count = await heldForSlot(ctx.tenantId, row.id, batchSlot);
      if (count >= 2) {
        state = await closeImageBatch({ ctx, chat, lines, config, client, lang, row, state });
        const front = state.slots.find((slot) => slot.id === batchSlot);
        if (front?.status === "uploaded") {
          state = commitIdBack(state, batchSlot);
          state = {
            ...state,
            profile: { ...state.profile, idBackPending: "", imageBatchSlot: "" },
          };
          acceptedAny = true;
          state = refreshDossier(state, config.rules, "");
        }
      }
      continue;
    }
    if (isImageFile(job.mime, job.filename)) {
      let slotId = batchSlot;
      let docType = state.slots.find((slot) => slot.id === slotId)?.docType ?? "";
      let biometric: "yes" | "no" | undefined;
      if (!slotId) {
        const judged = await judgeFileJob({ ctx, chat, lines, config, extract, lang, row, state, job });
        state = judged.state;
        if (judged.cooled) break;
        if (!judged.accepted) continue;
        slotId = judged.accepted.slotId;
        docType = judged.accepted.docType;
        biometric = judged.accepted.biometric;
        if (docType === "id_card") {
          state = noteIdBiometric(state, config.rules, slotId, biometric);
          state = noteAppendix(state, slotId, judged.accepted.appendix);
        }
      }
      await holdImage({ ctx, chat, lines, row, job, slotId, docType });
      const who = state.slots.find((slot) => slot.id === slotId)?.borrower;
      if (docType === "id_card" && biometric === "yes" && (who === "1" || who === "2")) {
        state = { ...state, profile: { ...state.profile, imageBatchSlot: slotId, idBackPending: who } };
        lines.push(withBorrower(chat, chat.documents.askIdBack, state.profile, who, lang));
        continue;
      }
      state = { ...state, profile: { ...state.profile, imageBatchSlot: slotId } };
      lines.push(chat.documents.askMorePhotos);
      continue;
    }
    const judged = await judgeFileJob({ ctx, chat, lines, config, extract, lang, row, state, job });
    state = judged.state;
    if (judged.cooled) break;
    if (!judged.accepted) continue;
    if (judged.accepted.docType === "id_card") {
      state = noteIdBiometric(state, config.rules, judged.accepted.slotId, judged.accepted.biometric);
      state = noteAppendix(state, judged.accepted.slotId, judged.accepted.appendix);
    }
    if (judged.accepted.docType === "id_card" && judged.accepted.biometric === "yes") {
      const who = state.slots.find((slot) => slot.id === judged.accepted?.slotId)?.borrower;
      await holdImage({
        ctx,
        chat,
        lines,
        row,
        job,
        slotId: judged.accepted.slotId,
        docType: "id_card",
      });
      if (who === "1" || who === "2") {
        state = { ...state, profile: { ...state.profile, imageBatchSlot: judged.accepted.slotId, idBackPending: who } };
        lines.push(withBorrower(chat, chat.documents.askIdBack, state.profile, who, lang));
        continue;
      }
    }
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
      coveredMonths: judged.accepted.coveredMonths,
    });
    state = uploaded.state;
    if (uploaded.accepted && judged.accepted.docType === "payslip") {
      const front = state.slots.find((slot) => slot.id === judged.accepted?.slotId);
      const months = [...(judged.accepted.payMonths ?? [])].sort();
      const extra = extraPayslipSlotIds(state, judged.accepted.slotId, months);
      for (const slotId of extra) {
        state = commitSlot(state, slotId, front?.remoteId ?? "", front?.filename || job.filename);
      }
      [judged.accepted.slotId, ...extra].forEach((slotId, index) => {
        if (months[index]) state = noteSlotMonths(state, slotId, [months[index]]);
      });
    }
    if (uploaded.accepted && judged.accepted.docType === "id_card") {
      state = commitSeenAppendix(state, judged.accepted.slotId);
    }
    if (uploaded.accepted && judged.accepted.slotId === batchSlot) {
      await dropHeld(ctx.tenantId, row.id, batchSlot);
      state = { ...state, profile: { ...state.profile, imageBatchSlot: "" } };
    }
    if (uploaded.accepted) acceptedAny = true;
    state = refreshDossier(state, config.rules, "");
  }

  const seenForms = new Set<string>();
  for (const slot of state.slots) {
    const form = config.rules.documents[slot.docType]?.blankForm;
    if (!form || seenForms.has(slot.docType) || !isOutstanding(slot, state.slots)) continue;
    if (offeredForms(state.profile).includes(slot.docType)) continue;
    seenForms.add(slot.docType);
    const label = docLabel(config.rules, slot.docType, lang);
    const caption = chat.documents.blankForm(label);
    try {
      const sent = await sendBlankForm(ctx, chat, slot.docType, form, label);
      if (sent === "already") {
        state = rememberOfferedForm(state, slot.docType);
        continue;
      }
      if (sent === "sent" || sent === "skipped") {
        state = rememberOfferedForm(state, slot.docType);
      }
      if (sent === "skipped") {
        lines.push(`${caption}\n${blankFormHref(ctx.tenantId, slot.docType, form.file)}`);
      }
      break;
    } catch (err) {
      warnDocuments("documents.form_failed", {
        conversationId: ctx.conversation.id,
        error: err instanceof Error ? err.message : String(err),
      });
      lines.push(caption);
      break;
    }
  }

  let reopened = false;
  const retract = turnIntents.find((intent) => intent.kind === "retract");
  if (retract && retract.kind === "retract" && retract.target === "latest") {
    const heldId = typeof state.profile.imageBatchSlot === "string" ? state.profile.imageBatchSlot : "";
    const held = state.slots.find((slot) => slot.id === heldId && slot.status !== "uploaded");
    if (held) {
      await dropHeld(ctx.tenantId, row.id, held.id);
      state = releaseHeldSlot(state, config.rules, held.id);
      reopened = true;
      lines.push(chat.documents.retracted);
      const again = documentFileAsk(state, config.rules, lang, chat);
      if (again) lines.push(again);
    }
  }
  if (retract && retract.kind === "retract" && !reopened) {
    const latestSlotId = retract.target === "latest"
      ? await newestUploadedSlotId(ctx.tenantId, row.id, state)
      : "";
    const undone = reopenNamedSlot(state, retract.target, latestSlotId);
    if (undone) {
      state = undone.state;
      reopened = true;
      lines.push(chat.documents.retracted);
      const slot = undone.slot;
      const again = slot.docType === "id_card_back"
        ? chat.documents.askIdBack
        : slot.docType === "id_card"
          ? chat.documents.askIdCard
          : slot.docType === "payslip"
            ? chat.documents.askPayslips
            : chat.documents.askStage(slotDisplayLabel(config.rules, slot, lang));
      lines.push(withBorrower(chat, again, state.profile, slot.borrower, lang));
    }
  }

  const help = turnIntents.find((intent) => intent.kind === "how_to");
  const helpOnly = Boolean(help && !applied.changed && !retract);
  if (help && help.kind === "how_to" && !reopened) {
    const slot = state.slots.find((item) => isOutstanding(item, state.slots));
    if (slot) {
      const helpLine = help.detail === "short" ? chat.documents.howTo(slot.docType) : chat.documents.howToDetail(slot.docType);
      lines.push(withBorrower(chat, helpLine, state.profile, slot.borrower, lang));
    }
  } else if (refreshText && declinesExistingLoans(refreshText)) {
    lines.push(chat.documents.noLoans);
  }

  if (state.status === "complete") {
    lines.push(chat.documents.complete);
    state = await openChecklistReview(ctx, state);
  }
  else if (state.status === "gathering" && !reopened && !helpOnly && (acceptedAny || lines.length === 0 || applied.changed || declinesExistingLoans(refreshText))) {
    lines.push(...gatheringLines(state, config.rules, lang, chat));
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
  return {
    ok: true,
    reply: customerReply(ctx, reply || documentFileAsk(state, config.rules, lang, chat)),
  };
}

/**
 * The advisor releases the next collection stage. No document types are invented.
 * The lead gets one agent message that the next documents are starting.
 */
export async function releaseNextDocumentStage(
  tenantId: string,
  leadId: string,
  lang: "en" | "he",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = await readConfig(tenantId);
  const dossier = await prisma.dossier.findFirst({
    where: { tenantId, leadId },
    orderBy: { createdAt: "desc" },
  });
  if (!dossier || !config) return { ok: false, error: "not_found" };
  const state = stateOf(dossier);
  if (state.status !== "complete") return { ok: false, error: "incomplete" };
  const current = releasedStageId(state.profile);
  const nextId = nextCollectionStageId(config.rules, current);
  if (!nextId) return { ok: false, error: "no_next_stage" };
  const open = await prisma.conversation.findFirst({
    where: { tenantId, leadId, status: { not: "closed" } },
    orderBy: { updatedAt: "desc" },
  });
  const latest = open ?? await prisma.conversation.findFirst({
    where: { tenantId, leadId },
    orderBy: { updatedAt: "desc" },
  });
  if (!latest) {
    console.warn(JSON.stringify({ msg: "documents.next_stage_no_conversation", tenantId, leadId }));
    return { ok: false, error: "no_open_conversation" };
  }
  if (latest.status === "closed") {
    await reopenConversation({ tenantId, conversationId: latest.id, reason: "documents_next_stage" });
  }
  const text = copyFor(lang).chat.documents.nextStage;
  const { sendAndSave } = await import("@/lib/flow/run-turn");
  const ctx = await loadTurnContext(tenantId, latest.id, { triggerMessageId: `documents-next-stage-${nextId}` });
  await sendAndSave(ctx, text, { idempotencyKey: `documents-next-stage-${leadId}-${nextId}` });
  const profile = { ...state.profile, releasedStageId: nextId };
  const slots = mergeSlots(state.slots, checklistSlots(profile, config.rules));
  const done = dossierDone(slots);
  await prisma.dossier.update({
    where: { id: dossier.id },
    data: {
      profile: profile as Prisma.InputJsonValue,
      slots: slots as unknown as Prisma.InputJsonValue,
      status: done ? "complete" : "gathering",
      activeStage: activeStageOf(slots),
    },
  });
  await safeRefreshLeadState(tenantId, leadId);
  return { ok: true };
}

/** The stored upload for a slot. One file can fill several slots, so match the remote id first. */
export function checklistFile<T extends { filename: string; remoteId: string }>(
  slot: { filename: string; remoteId: string },
  files: T[],
): T | undefined {
  return files.find((item) =>
    (slot.remoteId && item.remoteId === slot.remoteId) ||
    (slot.filename && item.filename === slot.filename),
  );
}

const IDENTITY_TYPES = new Set(["id_card", "id_card_back", "id_appendix"]);

export type ChecklistPiece = {
  id: string;
  docType: string;
  borrower: string;
  /** Borrower phrase when the file belongs to one of several people. Empty for a single borrower. */
  who: string;
  label: string;
  stage: string;
  status: "missing" | "uploaded";
  lastReason: string;
  filename: string;
  remoteId: string;
  href: string;
  mime: string;
  coveredMonths: string[];
  sourceFilename: string;
};

export type ChecklistFile = { href: string; mime: string };

export type ChecklistRow = {
  id: string;
  slotIds: string[];
  label: string;
  stage: string;
  status: string;
  lastReason: string;
  filename: string;
  remoteId: string;
  href: string;
  mime: string;
  files: ChecklistFile[];
};

/** Inclusive YYYY-MM span. A gap longer than a year stays as the two endpoints. */
export function expandMonthRange(start: string, end: string): string[] {
  const from = monthsIn(start)[0];
  const to = monthsIn(end)[0];
  if (!from || !to) return [...new Set([start, end].filter(Boolean))].sort();
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const begin = fromYear * 12 + fromMonth - 1;
  const finish = toYear * 12 + toMonth - 1;
  if (finish < begin || finish - begin > 11) return [...new Set([from, to])].sort();
  const out: string[] = [];
  for (let cursor = begin; cursor <= finish; cursor += 1) {
    const year = Math.floor(cursor / 12);
    const month = (cursor % 12) + 1;
    out.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return out;
}

function monthsNamedIn(filename: string): string[] {
  const unique = monthsIn(filename);
  if (unique.length === 2) return expandMonthRange(unique[0], unique[1]);
  return unique;
}

/** "3 תלושי שכר אוגוסט-אוקטובר" */
export function payslipFieldLabel(
  count: number,
  months: string[],
  lang: "en" | "he",
  now = new Date(),
): string {
  const noun = lang === "he"
    ? count === 1 ? "תלוש שכר" : "תלושי שכר"
    : count === 1 ? "Payslip" : "Payslips";
  const known = [...new Set(months)].sort();
  if (!known.length) return `${count} ${noun}`;
  const first = formatStatementMonth(known[0], lang, now);
  const last = formatStatementMonth(known[known.length - 1], lang, now);
  return `${count} ${noun} ${first === last ? first : `${first}-${last}`}`;
}

/**
 * The ID card, its other side, and the appendix are one field.
 * Payslips for one borrower are one field, named with their months.
 */
export function groupChecklistRows(
  slots: ChecklistPiece[],
  lang: "en" | "he",
  now = new Date(),
): ChecklistRow[] {
  const groups: ChecklistPiece[][] = [];
  const at = new Map<string, number>();
  for (const slot of slots) {
    const key = IDENTITY_TYPES.has(slot.docType)
      ? `identity:${slot.borrower || "1"}`
      : slot.docType === "payslip"
        ? `payslip:${slot.borrower || "1"}`
        : slot.id;
    const index = at.get(key);
    if (index === undefined) {
      at.set(key, groups.length);
      groups.push([slot]);
    } else {
      groups[index].push(slot);
    }
  }
  return groups.map((group) => {
    const first = group[0];
    const files: ChecklistFile[] = [];
    const seen = new Set<string>();
    for (const slot of group) {
      if (!slot.href || seen.has(slot.href)) continue;
      seen.add(slot.href);
      files.push({ href: slot.href, mime: slot.mime || "application/pdf" });
    }
    const uploaded = group.every((slot) => slot.status === "uploaded");
    const payslip = group.every((slot) => slot.docType === "payslip");
    const stored = [...new Set(group.flatMap((slot) => slot.coveredMonths))].sort();
    const named = stored.length
      ? stored
      : [...new Set(group.flatMap((slot) => monthsNamedIn(slot.sourceFilename)))].sort();
    const idLabel = group.find((slot) => slot.docType === "id_card")?.label;
    const base = payslip
      ? payslipFieldLabel(group.length, named, lang, now)
      : idLabel || first.label;
    const who = first.who.trim();
    const label = who ? copyFor(lang).chat.documents.ownedBy(base, who) : base;
    return {
      id: first.id,
      slotIds: group.map((slot) => slot.id),
      label,
      stage: first.stage,
      status: uploaded ? "uploaded" : "missing",
      lastReason: uploaded ? "" : group.find((slot) => slot.lastReason)?.lastReason ?? "",
      filename: first.filename,
      remoteId: group.find((slot) => slot.remoteId && !slot.remoteId.startsWith("local:"))?.remoteId ?? "",
      href: files[0]?.href ?? "",
      mime: files[0]?.mime ?? "application/pdf",
      files,
    };
  });
}

function returnedLineLabel(
  rules: RulesDocument | null,
  profile: Profile,
  slots: SlotState[],
  slotIds: string[],
  lang: "en" | "he",
): string {
  const wanted = new Set(slotIds);
  const pieces: ChecklistPiece[] = slots.filter((slot) => wanted.has(slot.id)).map((slot) => ({
    id: slot.id,
    docType: slot.docType,
    borrower: slot.borrower || "1",
    who: borrowerFileWho(profile, slot.borrower, lang),
    label: rules ? slotDisplayLabel(rules, slot, lang) : slot.docType,
    stage: slot.stage,
    status: "uploaded",
    lastReason: "",
    filename: slot.filename,
    remoteId: slot.remoteId,
    href: "",
    mime: "application/pdf",
    coveredMonths: slot.coveredMonths ?? [],
    sourceFilename: slot.filename,
  }));
  return groupChecklistRows(pieces, lang)[0]?.label ?? pieces[0]?.label ?? slotIds[0] ?? "";
}

/**
 * Decline part of a finished checklist. The named files become missing again,
 * the previous uploads are no longer the current file, and the review task can
 * open again once the customer replaces them.
 */
export async function returnChecklistDocuments(opts: {
  tenantId: string;
  leadId: string;
  groups: { slotIds: string[]; note: string }[];
  lang: "en" | "he";
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const groups = opts.groups
    .map((group) => ({ slotIds: group.slotIds.filter(Boolean), note: group.note.trim() }))
    .filter((group) => group.slotIds.length > 0 && group.note);
  if (!groups.length) return { ok: false, error: "empty" };
  const [config, dossier] = await Promise.all([
    readConfig(opts.tenantId),
    prisma.dossier.findFirst({
      where: { tenantId: opts.tenantId, leadId: opts.leadId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!dossier) return { ok: false, error: "not_found" };
  const state = stateOf(dossier);
  const next = reopenReturnedSlots(state, groups);
  const reopened = next.slots.filter((slot, index) => slot.status !== state.slots[index]?.status);
  if (!reopened.length) return { ok: false, error: "nothing_returned" };
  const noteFor = new Map(groups.flatMap((group) => group.slotIds.map((id) => [id, group.note] as const)));
  for (const slot of state.slots) {
    if (!reopened.some((item) => item.id === slot.id)) continue;
    const match = slot.remoteId
      ? { remoteId: slot.remoteId }
      : slot.filename
        ? { filename: slot.filename }
        : null;
    if (!match) continue;
    await prisma.leadDocument.updateMany({
      where: { tenantId: opts.tenantId, dossierId: dossier.id, status: "uploaded", ...match },
      data: {
        status: "rejected",
        validation: { reason: "returned", note: noteFor.get(slot.id) ?? "" } as Prisma.InputJsonValue,
      },
    });
  }
  await prisma.dossier.update({
    where: { id: dossier.id },
    data: {
      profile: next.profile as Prisma.InputJsonValue,
      slots: next.slots as unknown as Prisma.InputJsonValue,
      status: next.status,
      activeStage: next.activeStage,
    },
  });
  const lines = groups
    .filter((group) => group.slotIds.some((id) => reopened.some((slot) => slot.id === id)))
    .map((group) => ({
      label: returnedLineLabel(config?.rules ?? null, state.profile, state.slots, group.slotIds, opts.lang),
      note: group.note,
    }));
  await safeRefreshLeadState(opts.tenantId, opts.leadId);
  return { ok: true, text: copyFor(opts.lang).chat.documents.returnFiles(lines) };
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
  const current = releasedStageId(state.profile);
  const nextStageId = rules ? nextCollectionStageId(rules, current) : "";
  const files = await prisma.leadDocument.findMany({
    where: { tenantId, dossierId: dossier.id, status: "uploaded" },
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, remoteId: true, downloadUrl: true, mime: true },
  });
  return {
    status: state.status,
    activeStage: state.activeStage,
    releasedStageId: current,
    nextStageId: state.status === "complete" ? nextStageId : "",
    slots: groupChecklistRows(state.slots.map((slot) => {
      const linked = checklistFile(slot, files);
      const href = linked && (linked.downloadUrl || linked.remoteId.startsWith("local:"))
        ? `/api/leads/${leadId}/documents/${linked.id}`
        : "";
      return {
        id: slot.id,
        docType: slot.docType,
        borrower: slot.borrower || "1",
        who: borrowerFileWho(state.profile, slot.borrower, lang),
        label: rules ? slotDisplayLabel(rules, slot, lang) : slot.docType,
        stage: slot.stage,
        status: slot.status,
        lastReason: slot.lastReason,
        filename: slot.filename,
        remoteId: slot.remoteId,
        href,
        mime: linked?.mime || "application/pdf",
        coveredMonths: slot.coveredMonths ?? [],
        sourceFilename: linked?.filename || slot.filename,
      };
    }), lang),
  };
}
