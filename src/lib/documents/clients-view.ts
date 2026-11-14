/**
 * Clients screen (documents). One row per lead with a document file (Dossier);
 * the file drives the status. Campaign contacts synced from the CRM are a
 * separate list and do not appear here. When the documents client list from
 * Smart NPV lands (PR #42), its clients with no file come back as a
 * "not started" tab. Demo-simulator and test-phone people are hidden unless asked for.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay, isDemoLead, leadDisplayName } from "@/lib/leads";
import { isTestLead, type DocumentConfig } from "@/lib/flow/document-config";
import {
  checklistPieces,
  dossierStateOf,
  groupChecklistRows,
  loadDocumentConfig,
  type ChecklistPiece,
} from "./dossier";
import { docLabel, stageLabel, type RulesDocument } from "./rules";
import { nextCollectionStageId, releasedStageId } from "./mortgage-rules";
import { isOutstanding, type DossierState, type SlotState } from "./validate";
import { DOCUMENT_TASK_REASONS } from "./review-task";
import { getConnector } from "@/lib/client-sources/registry";

export const CLIENT_TABS = ["needs", "collecting", "done", "all"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];
export const CLIENTS_CASE_PAGE = 50;
/** A file waiting on the lead longer than this shows as stuck. */
export const STUCK_DAYS = 4;

export function isClientTab(value: unknown): value is ClientTab {
  return typeof value === "string" && (CLIENT_TABS as readonly string[]).includes(value);
}

/** needs_you: an open documents task. waiting_id: no Smart NPV match yet. */
export type CaseState = "needs_you" | "waiting_id" | "collecting" | "complete" | "not_started";
export type Segment = "ok" | "missing" | "issue";

export type ClientRowDTO = {
  /** URL key: the lead id. */
  key: string;
  leadId: string | null;
  name: string;
  phone: string;
  test: boolean;
  state: CaseState;
  taskKind: "review" | "advisor" | null;
  waveLabel: string;
  waveIndex: number;
  waveCount: number;
  segments: Segment[];
  done: number;
  total: number;
  /** Complete, reviewed, and the rules have another wave the advisor may open. */
  nextWaveReady: boolean;
  lastActivity: string | null;
  /** Days since the lead last wrote, while we are waiting on them. */
  stuckDays: number;
};

export type ClientCounts = Record<ClientTab, number>;

type DossierRow = {
  id: string;
  leadId: string;
  status: string;
  smartClientId: string;
  profile: Prisma.JsonValue;
  slots: Prisma.JsonValue;
  activeStage: string;
  updatedAt: Date;
  conversationId: string;
};

type LeadLite = {
  id: string;
  displayName: string | null;
  externalUserId: string;
  fields: Prisma.JsonValue;
  lastLeadMessageAt: Date | null;
  lastOutboundAt: Date | null;
};

type ContactLite = { id: string; name: string; phone: string; leadId: string | null };

function leadPhone(lead: LeadLite): string {
  const fields = (lead.fields ?? {}) as Record<string, unknown>;
  return typeof fields.phone === "string" && fields.phone ? fields.phone : lead.externalUserId;
}

function isTestPerson(lead: LeadLite, config: DocumentConfig | null): boolean {
  if (isDemoLead(lead.externalUserId)) return true;
  // A keyless tenant is all test mode; only an explicit test phone hides a person.
  return Boolean(config?.apiKeyEnc) && Boolean(config) && isTestLead(config!, leadPhone(lead));
}

function waves(rules: RulesDocument | null) {
  return rules?.collectionStages?.length
    ? rules.collectionStages
    : [{ id: "1", labels: { he: "שלב 1", en: "Stage 1" } }];
}

/** One segment per display row of the released waves, the same grouping the checklist shows. */
function segmentsOf(state: DossierState, rules: RulesDocument | null, lang: "en" | "he"): Segment[] {
  const released = releasedStageId(state.profile);
  const current = state.slots.filter((slot) => (slot.collectionStage ?? "1") === released);
  const pieces = checklistPieces({ leadId: "", state: { ...state, slots: current }, rules, files: [], lang });
  return groupChecklistRows(pieces, lang).map((row) => {
    if (row.status === "uploaded") return "ok";
    return row.lastReason ? "issue" : "missing";
  });
}

function daysSince(date: Date | null, now: Date): number {
  if (!date) return 0;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function caseRow(opts: {
  dossier: DossierRow;
  lead: LeadLite;
  contact: ContactLite | undefined;
  task: { reason: string } | undefined;
  rules: RulesDocument | null;
  config: DocumentConfig | null;
  lang: "en" | "he";
  now: Date;
}): ClientRowDTO {
  const { dossier, lead, contact, task, rules, lang, now } = opts;
  const state = dossierStateOf(dossier);
  const all = waves(rules);
  const released = releasedStageId(state.profile);
  const waveIndex = Math.max(0, all.findIndex((wave) => wave.id === released));
  const segments = state.status === "needs_id" ? [] : segmentsOf(state, rules, lang);
  const caseState: CaseState = task
    ? "needs_you"
    : state.status === "needs_id"
      ? "waiting_id"
      : state.status === "complete"
        ? "complete"
        : "collecting";
  const lastLead = lead.lastLeadMessageAt;
  // Conversation time, not the file's: a refresh of the file is not activity.
  const lastActivity = [lastLead, lead.lastOutboundAt]
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? dossier.updatedAt;
  const waiting = caseState === "collecting" || caseState === "waiting_id";
  return {
    key: lead.id,
    leadId: lead.id,
    name: contact?.name || leadDisplayName(lead) || formatPhoneDisplay(leadPhone(lead)),
    phone: formatPhoneDisplay(contact?.phone || leadPhone(lead)),
    test: isTestPerson(lead, opts.config),
    state: caseState,
    taskKind: task ? (task.reason === "document_checklist_complete" ? "review" : "advisor") : null,
    waveLabel: all[waveIndex]?.labels[lang] ?? "",
    waveIndex,
    waveCount: all.length,
    segments,
    done: segments.filter((s) => s === "ok").length,
    total: segments.length,
    nextWaveReady: caseState === "complete" && Boolean(rules && nextCollectionStageId(rules, released)),
    lastActivity: lastActivity?.toISOString() ?? null,
    stuckDays: waiting ? daysSince(lastLead ?? dossier.updatedAt, now) : 0,
  };
}

function tabOf(row: ClientRowDTO): Exclude<ClientTab, "all"> {
  if (row.state === "needs_you") return "needs";
  if (row.state === "complete") return "done";
  return "collecting";
}

function matchesQuery(row: ClientRowDTO, q: string): boolean {
  if (!q) return true;
  const digits = q.replace(/\D/g, "").replace(/^0/, "");
  if (row.name.toLowerCase().includes(q.toLowerCase())) return true;
  return digits.length >= 3 && row.phone.replace(/\D/g, "").includes(digits);
}

/** Latest file per lead. */
async function loadCases(tenantId: string): Promise<DossierRow[]> {
  const rows = await prisma.dossier.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      leadId: true,
      status: true,
      smartClientId: true,
      profile: true,
      slots: true,
      activeStage: true,
      updatedAt: true,
      conversationId: true,
    },
  });
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.leadId) ? false : (seen.add(row.leadId), true)));
}

const LEAD_SELECT = {
  id: true,
  displayName: true,
  externalUserId: true,
  fields: true,
  lastLeadMessageAt: true,
  lastOutboundAt: true,
} as const;

export async function listClientCases(opts: {
  tenantId: string;
  tab: ClientTab;
  q: string;
  showTest: boolean;
  page: number;
  lang: "en" | "he";
}): Promise<{ rows: ClientRowDTO[]; counts: ClientCounts; total: number; hiddenTest: number; testOnly: boolean }> {
  const { tenantId, lang } = opts;
  const now = new Date();
  const [config, cases] = await Promise.all([loadDocumentConfig(tenantId), loadCases(tenantId)]);
  const leadIds = cases.map((row) => row.leadId);
  const [leads, contacts, tasks] = await Promise.all([
    prisma.lead.findMany({ where: { tenantId, id: { in: leadIds } }, select: LEAD_SELECT }),
    prisma.contact.findMany({
      where: { tenantId, leadId: { in: leadIds } },
      select: { id: true, name: true, phone: true, leadId: true },
    }),
    prisma.hitlTask.findMany({
      where: { tenantId, status: "open", leadId: { in: leadIds }, reason: { in: [...DOCUMENT_TASK_REASONS] } },
      orderBy: { createdAt: "desc" },
      select: { leadId: true, reason: true },
    }),
  ]);
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const contactByLead = new Map(contacts.map((contact) => [contact.leadId ?? "", contact]));
  const taskByLead = new Map<string, { reason: string }>();
  for (const task of tasks) if (!taskByLead.has(task.leadId)) taskByLead.set(task.leadId, task);

  let caseRows = cases.flatMap((dossier) => {
    const lead = leadById.get(dossier.leadId);
    if (!lead) return [];
    return [caseRow({
      dossier,
      lead,
      contact: contactByLead.get(lead.id),
      task: taskByLead.get(lead.id),
      rules: config?.rules ?? null,
      config,
      lang,
      now,
    })];
  });
  const hiddenTest = opts.showTest ? 0 : caseRows.filter((row) => row.test).length;
  if (!opts.showTest) caseRows = caseRows.filter((row) => !row.test);
  caseRows = caseRows.filter((row) => matchesQuery(row, opts.q));

  const counts: ClientCounts = { needs: 0, collecting: 0, done: 0, all: caseRows.length };
  for (const row of caseRows) counts[tabOf(row)] += 1;

  const order: Record<CaseState, number> = { needs_you: 0, waiting_id: 1, collecting: 1, complete: 2, not_started: 3 };
  caseRows.sort((a, b) =>
    order[a.state] - order[b.state] ||
    // Inside collecting, the longest wait first: those are the ones to chase.
    b.stuckDays - a.stuckDays ||
    (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
  );

  const skip = (opts.page - 1) * CLIENTS_CASE_PAGE;
  const inTab = opts.tab === "all" ? caseRows : caseRows.filter((row) => tabOf(row) === opts.tab);
  return { rows: inTab.slice(skip, skip + CLIENTS_CASE_PAGE), counts, total: inTab.length, hiddenTest, testOnly: !config?.apiKeyEnc };
}

/* ------------------------------------------------------------------------ */
/* One client                                                               */
/* ------------------------------------------------------------------------ */

export type CaseDocRow = {
  id: string;
  slotIds: string[];
  docType: string;
  label: string;
  status: "uploaded" | "missing";
  /** Operator reason key from the last rejected try, or the advisor's return note. */
  reason: string;
  files: { href: string; mime: string }[];
  requested: boolean;
};

export type CaseWave = {
  id: string;
  label: string;
  state: "done" | "current" | "locked";
  done: number;
  total: number;
  topics: { id: string; label: string; rows: CaseDocRow[] }[];
};

export type CaseFileLog = {
  id: string;
  label: string;
  filename: string;
  status: string;
  reason: string;
  at: string;
  href: string;
  mime: string;
};

export type ClientCaseDTO = {
  key: string;
  leadId: string | null;
  name: string;
  phone: string;
  test: boolean;
  testOnly: boolean;
  /** CRM details when the same person is a synced contact; fields carry the connector's labels. */
  contact: {
    dealDate: string | null;
    fields: { key: string; label: string; value: string }[];
  } | null;
  state: CaseState;
  task: { id: string; kind: "review" | "advisor"; summary: string; since: string } | null;
  waves: CaseWave[];
  nextWave: { id: string; label: string } | null;
  catalog: { docType: string; label: string; topic: string; open: boolean }[];
  log: CaseFileLog[];
  lastLeadMessageAt: string | null;
  stuckDays: number;
  hasConversation: boolean;
};

function rowsFor(
  slots: SlotState[],
  all: SlotState[],
  pieces: ChecklistPiece[],
  lang: "en" | "he",
): CaseDocRow[] {
  const ids = new Set(slots.map((slot) => slot.id));
  const bySlot = new Map(all.map((slot) => [slot.id, slot]));
  return groupChecklistRows(pieces.filter((piece) => ids.has(piece.id)), lang).map((row) => {
    const members = row.slotIds.map((id) => bySlot.get(id)).filter((slot): slot is SlotState => Boolean(slot));
    // An alt-group sibling that is filled closes the row even though this slot is empty.
    const open = members.some((slot) => isOutstanding(slot, all));
    return {
      id: row.id,
      slotIds: row.slotIds,
      docType: members[0]?.docType ?? "",
      label: row.label,
      status: open ? "missing" : "uploaded",
      reason: open ? row.lastReason : "",
      files: row.files,
      requested: members.some((slot) => slot.requested),
    };
  });
}

function simpleFields(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && raw.trim()) out[key] = raw.trim();
    else if (typeof raw === "number") out[key] = String(raw);
  }
  return out;
}

/**
 * CRM details for the file: the CRM's own name (e.g. "Smart NPV") and the
 * readable catalog fields with their labels. Codes, flags and derived values
 * (status id, archived, deal year) are left out; the deal date has its own row.
 */
function crmDetails(
  contact: { dealDate: Date | null; mapped: Prisma.JsonValue; source: { kind: string; label: string } },
  lang: "en" | "he",
): NonNullable<ClientCaseDTO["contact"]> {
  const connector = getConnector(contact.source.kind);
  const values = simpleFields(contact.mapped);
  const fields = (connector?.fieldCatalog ?? [])
    .filter((def) => def.type === "text" && !def.derived && !def.key.endsWith("_id") && values[def.key])
    .filter((def) => !/\((?:קוד|code)\)|\bid\b/i.test(def.label[lang]))
    .map((def) => ({ key: def.key, label: def.label[lang], value: values[def.key] }));
  return {
    dealDate: contact.dealDate?.toISOString() ?? null,
    fields,
  };
}

export async function loadClientCase(opts: {
  tenantId: string;
  key: string;
  lang: "en" | "he";
}): Promise<ClientCaseDTO | null> {
  const { tenantId, lang } = opts;
  const now = new Date();
  const lead = await prisma.lead.findFirst({ where: { tenantId, id: opts.key }, select: LEAD_SELECT });
  if (!lead) return null;
  // CRM details, when the same person was also synced as a contact.
  const contact = await prisma.contact.findFirst({
    where: { tenantId, leadId: lead.id },
    select: { id: true, name: true, phone: true, leadId: true, dealDate: true, mapped: true, source: { select: { kind: true, label: true } } },
  });

  const contactView = contact ? crmDetails(contact, lang) : null;
  const [config, dossier, conversations] = await Promise.all([
    loadDocumentConfig(tenantId),
    lead
      ? prisma.dossier.findFirst({ where: { tenantId, leadId: lead.id }, orderBy: { createdAt: "desc" } })
      : null,
    lead ? prisma.conversation.count({ where: { tenantId, leadId: lead.id } }) : 0,
  ]);
  const base = {
    key: opts.key,
    leadId: lead?.id ?? null,
    name: contact?.name || (lead ? leadDisplayName(lead) : "") || formatPhoneDisplay(contact?.phone ?? (lead ? leadPhone(lead) : "")),
    phone: formatPhoneDisplay(contact?.phone || (lead ? leadPhone(lead) : "")),
    test: lead ? isTestPerson(lead, config) : false,
    testOnly: !config?.apiKeyEnc,
    contact: contactView,
    lastLeadMessageAt: lead?.lastLeadMessageAt?.toISOString() ?? null,
    hasConversation: conversations > 0,
  };
  if (!dossier || !lead) {
    return { ...base, state: "not_started", task: null, waves: [], nextWave: null, catalog: [], log: [], stuckDays: 0 };
  }

  const rules = config?.rules ?? null;
  const state = dossierStateOf(dossier);
  const [files, log, task] = await Promise.all([
    prisma.leadDocument.findMany({
      where: { tenantId, dossierId: dossier.id, status: "uploaded" },
      orderBy: { createdAt: "desc" },
      select: { id: true, filename: true, remoteId: true, downloadUrl: true, mime: true },
    }),
    prisma.leadDocument.findMany({
      where: { tenantId, dossierId: dossier.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, docType: true, filename: true, status: true, validation: true, createdAt: true, mime: true, bytesEnc: false, downloadUrl: true, remoteId: true },
    }),
    prisma.hitlTask.findFirst({
      where: { tenantId, leadId: lead.id, status: "open", reason: { in: [...DOCUMENT_TASK_REASONS] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, reason: true, payload: true, createdAt: true },
    }),
  ]);

  const pieces = checklistPieces({ leadId: lead.id, state, rules, files, lang });
  const all = waves(rules);
  const released = releasedStageId(state.profile);
  const releasedIndex = Math.max(0, all.findIndex((wave) => wave.id === released));
  const topicOrder = rules?.stages ?? [];
  const caseWaves: CaseWave[] = all.map((wave, index) => {
    const slots = state.slots.filter((slot) => (slot.collectionStage ?? "1") === wave.id);
    const rows = rowsFor(slots, state.slots, pieces, lang);
    const topicIds = [...new Set(slots.map((slot) => slot.stage))].sort(
      (a, b) => topicOrder.findIndex((t) => t.id === a) - topicOrder.findIndex((t) => t.id === b),
    );
    const topics = topicIds.map((topic) => {
      const ids = new Set(slots.filter((slot) => slot.stage === topic).map((slot) => slot.id));
      return {
        id: topic,
        label: rules ? stageLabel(rules, topic, lang) : topic,
        rows: rows.filter((row) => row.slotIds.some((id) => ids.has(id))),
      };
    });
    const isCurrent = index === releasedIndex;
    const doneCount = rows.filter((row) => row.status === "uploaded").length;
    return {
      id: wave.id,
      label: wave.labels[lang],
      state: index < releasedIndex || (isCurrent && state.status === "complete" && !task) ? "done" : isCurrent ? "current" : "locked",
      done: doneCount,
      total: rows.length,
      topics,
    };
  });

  const caseState: CaseState = task
    ? "needs_you"
    : state.status === "needs_id"
      ? "waiting_id"
      : state.status === "complete"
        ? "complete"
        : "collecting";
  const nextId = rules && state.status === "complete" && !task ? nextCollectionStageId(rules, released) : "";
  const nextWave = nextId ? { id: nextId, label: all.find((wave) => wave.id === nextId)?.labels[lang] ?? nextId } : null;

  const outstanding = new Set(state.slots.filter((slot) => isOutstanding(slot, state.slots)).map((slot) => slot.docType));
  const catalog = rules
    ? Object.entries(rules.documents)
        .filter(([docType]) => docType !== "id_card_back")
        .map(([docType, def]) => {
          const topic = rules.requirements.find((item) => item.docType === docType)?.stage ?? "";
          return {
            docType,
            label: def.labels[lang] ?? docType,
            topic: topic ? stageLabel(rules, topic, lang) : "",
            open: outstanding.has(docType),
          };
        })
    : [];

  const payload = (task?.payload ?? {}) as { summary?: unknown };
  return {
    ...base,
    state: caseState,
    task: task
      ? {
          id: task.id,
          kind: task.reason === "document_checklist_complete" ? "review" : "advisor",
          summary: typeof payload.summary === "string" ? payload.summary : "",
          since: task.createdAt.toISOString(),
        }
      : null,
    waves: state.status === "needs_id" ? [] : caseWaves,
    nextWave,
    catalog,
    log: log.map((doc) => {
      const validation = (doc.validation ?? {}) as { reason?: unknown; note?: unknown };
      const viewable = doc.status !== "rejected" && (doc.downloadUrl || doc.remoteId.startsWith("local:"));
      return {
        id: doc.id,
        label: rules && doc.docType ? docLabel(rules, doc.docType, lang) : doc.docType,
        filename: doc.filename,
        status: doc.status,
        reason: typeof validation.note === "string" && validation.note
          ? validation.note
          : typeof validation.reason === "string" ? validation.reason : "",
        at: doc.createdAt.toISOString(),
        href: viewable ? `/api/leads/${lead.id}/documents/${doc.id}` : "",
        mime: doc.mime || "application/pdf",
      };
    }),
    stuckDays: caseState === "collecting" || caseState === "waiting_id"
      ? daysSince(lead.lastLeadMessageAt ?? dossier.updatedAt, now)
      : 0,
  };
}
