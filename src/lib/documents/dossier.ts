import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { copyFor, replyLang } from "@/lib/copy";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { loadInstanceConfig } from "@/lib/capability-instances";
import { documentApiKey, parseDocumentConfig, type DocumentConfig } from "@/lib/flow/document-config";
import type { TurnContext } from "@/lib/flow/types";
import { extractDocument, type DocExtraction } from "./extract";
import { docLabel, requiredSlots, type Profile, type RulesDocument } from "./rules";
import { smartClientFor, type SmartClient } from "./smart-npv";
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

export async function loadDocumentsTurnState(args: {
  tenantId: string;
  leadId: string;
  conversationId: string;
}): Promise<DocumentsTurnState> {
  const config = await readConfig(args.tenantId);
  if (!config) {
    return { configured: false, runIngest: false, status: "", activeStage: "", missing: [] };
  }
  const [dossier, latest, stored] = await Promise.all([
    prisma.dossier.findFirst({
      where: { tenantId: args.tenantId, leadId: args.leadId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.message.findFirst({
      where: { tenantId: args.tenantId, conversationId: args.conversationId, role: "lead" },
      orderBy: { createdAt: "desc" },
      select: { id: true, metadata: true },
    }),
    prisma.leadDocument.count({
      where: { tenantId: args.tenantId, leadId: args.leadId, status: "stored" },
    }),
  ]);
  const attachments = latest ? attachmentsOf(latest.metadata) : [];
  const finished = latest
    ? await prisma.leadDocument.count({
        where: {
          tenantId: args.tenantId,
          messageId: latest.id,
          status: { in: ["rejected", "uploaded"] },
        },
      })
    : 0;
  const state = dossier ? stateOf(dossier) : null;
  const runIngest =
    !state ||
    state.status === "needs_id" ||
    attachments.length > finished ||
    stored > 0;
  return {
    configured: true,
    runIngest,
    status: state?.status ?? "",
    activeStage: state?.activeStage ?? "",
    missing: state ? missingLabels(state, config.rules, "en") : [],
  };
}

function reasonText(chat: ReturnType<typeof copyFor>["chat"], reason: string): string {
  return chat.documents.reasons[reason] ?? chat.documents.reasons.unreadable ?? reason;
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

  const latest = await prisma.message.findFirst({
    where: { tenantId: ctx.tenantId, conversationId: ctx.conversation.id, role: "lead" },
    orderBy: { createdAt: "desc" },
  });
  const typedId = nationalIdFromText(latest?.text ?? "");
  const phone =
    ctx.channel?.customerPhone ||
    (typeof ctx.lead.fields.phone === "string" ? ctx.lead.fields.phone : "") ||
    ctx.lead.externalUserId;

  let row = await prisma.dossier.findFirst({
    where: { tenantId: ctx.tenantId, leadId: ctx.lead.id },
    orderBy: { createdAt: "desc" },
  });

  if (!row || row.status === "needs_id") {
    const found =
      (await client.findClient({ phone })) ||
      (typedId ? await client.findClient({ nationalId: typedId }) : null);
    if (!found) {
      const data = {
        tenantId: ctx.tenantId,
        leadId: ctx.lead.id,
        conversationId: ctx.conversation.id,
        status: "needs_id",
        profile: { lookupId: typedId } as Prisma.InputJsonValue,
        slots: [] as Prisma.InputJsonValue,
        activeStage: "",
        smartClientId: "",
      };
      row = row
        ? await prisma.dossier.update({ where: { id: row.id }, data })
        : await prisma.dossier.create({ data });
      await safeRefreshLeadState(ctx.tenantId, ctx.lead.id);
      return { ok: true, reply: typedId ? chat.documents.notFound : chat.documents.askId };
    }
    const opened = freshDossier({
      smartClientId: found.clientId,
      profile: found.profile,
      slots: requiredSlots(found.profile, config.rules),
    });
    const data = {
      status: opened.status,
      smartClientId: opened.smartClientId,
      profile: opened.profile as Prisma.InputJsonValue,
      slots: opened.slots as unknown as Prisma.InputJsonValue,
      activeStage: opened.activeStage,
      conversationId: ctx.conversation.id,
    };
    row = row
      ? await prisma.dossier.update({ where: { id: row.id }, data })
      : await prisma.dossier.create({
          data: { tenantId: ctx.tenantId, leadId: ctx.lead.id, ...data },
        });
    if (!latest || attachmentsOf(latest.metadata).length === 0) {
      lines.push(chat.documents.askStage(missingLabels(opened, config.rules, lang).join(", ")));
    }
  }

  if (!row) return { ok: false, reply: chat.documents.notConfigured };
  let state = stateOf(row);
  if (state.status === "blocked" || state.status === "complete") {
    await safeRefreshLeadState(ctx.tenantId, ctx.lead.id);
    return {
      ok: true,
      reply: lines.join(" ") || (state.status === "complete" ? chat.documents.complete : chat.documents.escalated),
    };
  }

  const pendingDocs = await prisma.leadDocument.findMany({
    where: { tenantId: ctx.tenantId, dossierId: row.id, status: "stored" },
    orderBy: { createdAt: "asc" },
  });
  const seenNames = new Set(
    (
      await prisma.leadDocument.findMany({
        where: { tenantId: ctx.tenantId, messageId: latest?.id ?? "", status: { not: "stored" } },
        select: { filename: true },
      })
    ).map((doc) => doc.filename),
  );

  let acceptedAny = false;
  type Job = { id?: string; filename: string; mime: string; bytes: Buffer | null; resume?: { slotId: string; docType: string } };
  const jobs: Job[] = [];
  for (const doc of pendingDocs) {
    if (!doc.bytesEnc) continue;
    const validation = isRecord(doc.validation) ? doc.validation : {};
    jobs.push({
      id: doc.id,
      filename: doc.filename,
      mime: doc.mime,
      bytes: decryptBytes(doc.bytesEnc),
      resume:
        validation.accepted === true && typeof validation.slotId === "string"
          ? { slotId: validation.slotId, docType: String(validation.docType ?? "") }
          : undefined,
    });
  }
  if (latest) {
    for (const attachment of attachmentsOf(latest.metadata)) {
      if (seenNames.has(attachment.filename)) continue;
      if (jobs.some((job) => job.filename === attachment.filename && !job.id)) continue;
      let bytes: Buffer | null = null;
      try {
        bytes = attachment.bytesEnc ? decryptBytes(attachment.bytesEnc) : attachment.url ? await downloadUrl(attachment.url) : null;
      } catch (err) {
        const reason = err instanceof Error && err.message === "too_large" ? "too_large" : "unreadable";
        lines.push(chat.documents.rejected(attachment.filename, reasonText(chat, reason)));
        continue;
      }
      if (!bytes) continue;
      jobs.push({ filename: attachment.filename, mime: attachment.mime, bytes });
    }
  }

  for (const job of jobs) {
    if (!job.bytes && !job.resume) continue;
    const open = state.slots
      .filter((slot) => slot.status === "missing")
      .map((slot) => ({
        docType: slot.docType,
        label: docLabel(config.rules, slot.docType, "en"),
        fields: config.rules.documents[slot.docType]?.fields ?? [],
      }));
    let slotId = job.resume?.slotId ?? "";
    let docType = job.resume?.docType ?? "";
    if (!job.resume) {
      if (!job.bytes) continue;
      const extracted: DocExtraction = await extract({
        bytes: job.bytes,
        mime: job.mime,
        filename: job.filename,
        open,
      });
      const judged = judgeFile(state, config.rules, extracted);
      if (judged.kind === "reject") {
        state = judged.state;
        const label = docLabel(config.rules, state.slots.find((slot) => slot.id === judged.slotId)?.docType ?? "", lang);
        lines.push(chat.documents.rejected(label || job.filename, reasonText(chat, judged.reason)));
        const saved = job.id
          ? job.id
          : (
              await prisma.leadDocument.create({
                data: {
                  tenantId: ctx.tenantId,
                  leadId: ctx.lead.id,
                  dossierId: row.id,
                  messageId: latest?.id ?? "",
                  filename: job.filename,
                  mime: job.mime,
                  docType: extracted.docType,
                  status: "rejected",
                  validation: { reason: judged.reason } as Prisma.InputJsonValue,
                  bytesEnc: null,
                },
              })
            ).id;
        if (job.id) {
          await prisma.leadDocument.update({
            where: { id: saved },
            data: { status: "rejected", bytesEnc: null, validation: { reason: judged.reason } },
          });
        }
        if (judged.escalated) {
          await prisma.$transaction([
            prisma.hitlTask.create({
              data: {
                tenantId: ctx.tenantId,
                conversationId: ctx.conversation.id,
                leadId: ctx.lead.id,
                type: "more_info",
                reason: "document_review",
                payload: { summary: judged.reason },
                status: "open",
              },
            }),
            prisma.conversation.update({
              where: { id: ctx.conversation.id },
              data: { status: "waiting_human", flowState: "waiting_human" },
            }),
          ]);
          ctx.conversation.status = "waiting_human";
          ctx.conversation.flowState = "waiting_human";
          lines.push(chat.documents.escalated);
          break;
        }
        continue;
      }
      slotId = judged.slotId;
      docType = judged.docType;
    }

    const docRow = job.id
      ? { id: job.id }
      : await prisma.leadDocument.create({
          data: {
            tenantId: ctx.tenantId,
            leadId: ctx.lead.id,
            dossierId: row.id,
            messageId: latest?.id ?? "",
            filename: job.filename,
            mime: job.mime,
            docType,
            status: "stored",
            validation: { accepted: true, slotId, docType } as Prisma.InputJsonValue,
            bytesEnc: job.bytes ? encryptBytes(job.bytes) : null,
          },
        });
    try {
      if (!job.bytes) throw new Error("missing bytes");
      const uploaded = await client.upload({
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
      lines.push(chat.documents.received(docLabel(config.rules, docType, lang)));
      acceptedAny = true;
    } catch {
      await prisma.leadDocument.update({
        where: { id: docRow.id },
        data: {
          status: "stored",
          docType,
          bytesEnc: job.bytes ? encryptBytes(job.bytes) : undefined,
          validation: { accepted: true, slotId, docType } as Prisma.InputJsonValue,
        },
      });
      lines.push(chat.documents.uploadFailed);
    }
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
      include: {
        documents: { orderBy: { createdAt: "desc" }, take: 20 },
      },
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
