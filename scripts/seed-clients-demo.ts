/**
 * Local demo data for the Clients screen (documents). Run: `npm run db:seed:clients`.
 *
 * Seeds the dev tenant (DEV_TENANT_ID, else the first tenant) with a documents
 * capability (two collection stages, no Smart NPV key, so nothing is ever sent
 * to Smart NPV and the screen shows its test-mode strip) and 7 clients, one per
 * state: review needed, collecting with a rejected file, advisor needed,
 * waiting for ID, complete, stage 2 open, quiet for 6 days. Two of them also get
 * a CRM contact (same Smart NPV uuid) so the file shows CRM details.
 *
 * Re-running resets those 7 clients to the starting state. It refuses to run
 * against anything but a local database.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptBytes } from "@/lib/crypto";
import { MORTGAGE_RULES, checklistSlots } from "@/lib/documents/mortgage-rules";
import { mapSmartProfile } from "@/lib/documents/smart-npv";
import { freshDossier, dossierDone, activeStageOf, type SlotState } from "@/lib/documents/validate";
import type { RulesDocument } from "@/lib/documents/rules";

const RULES: RulesDocument = {
  ...MORTGAGE_RULES,
  stages: [...MORTGAGE_RULES.stages, { id: "property", labels: { he: "נכס ועסקה", en: "Property and deal" } }],
  collectionStages: [
    { id: "1", labels: { he: "מסמכים ראשונים", en: "First documents" } },
    { id: "2", labels: { he: "אישור עקרוני ונכס", en: "Approval and property" } },
  ],
  documents: {
    ...MORTGAGE_RULES.documents,
    purchase_contract: { labels: { he: "חוזה רכישה", en: "Purchase contract" }, fields: [], checks: [] },
    appraisal: { labels: { he: "דוח שמאי", en: "Appraisal report" }, fields: [], checks: [] },
    land_registry: { labels: { he: "נסח טאבו", en: "Land registry extract" }, fields: [], checks: [] },
  },
  requirements: [
    ...MORTGAGE_RULES.requirements,
    { docType: "purchase_contract", stage: "property", collectionStage: "2" },
    { docType: "appraisal", stage: "property", collectionStage: "2" },
    { docType: "land_registry", stage: "property", collectionStage: "2" },
  ],
};

async function pdf(title: string): Promise<string> {
  const text = title.replace(/[()\\]/g, "");
  const stream = `BT /F1 18 Tf 40 540 Td (${text}) Tj ET BT /F1 11 Tf 40 510 Td (Sample document for local development) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encryptBytes(Buffer.from(out, "latin1"));
}

function profileFor(first: string, last: string, phone: string, extra: Record<string, unknown> = {}) {
  return {
    ...mapSmartProfile({
      id_1: "123456782",
      firstname_1: first,
      lastname_1: last,
      phone_1: phone,
      status_report_1: "1",
      banks_accounts: [{ uuid: "acct-1" }, { uuid: "acct-2" }],
      liabilities: [{ balance: "1" }],
      ...extra,
    }),
    firstHome: "true",
    secondBorrower: "no",
  } as Record<string, unknown>;
}

type Spec = {
  name: string;
  phone: string;
  uploaded: number | "all";
  rejectOne?: string;
  stage2?: boolean;
  task?: "review" | "advisor";
  taskSummary?: string;
  needsId?: boolean;
  ageDays: number;
  pipeline?: string;
};

const SPECS: Spec[] = [
  { name: "נועה ברק", phone: "972521234567", uploaded: "all", task: "review", ageDays: 0.1 },
  { name: "אורי שטרן", phone: "972547771203", uploaded: 5, rejectOne: "matches_profile", ageDays: 0.4 },
  { name: "יוסי אלמוג", phone: "972503318842", uploaded: 3, task: "advisor", taskSummary: "הלקוח שלח 5 פעמים תדפיס עו״ש שלא מכסה את החודשים הנדרשים וביקש לדבר עם יועץ.", rejectOne: "prior_calendar_months", ageDays: 1.2 },
  { name: "רותם כהן", phone: "972586602119", uploaded: 0, needsId: true, ageDays: 2.5 },
  { name: "אביטל דהן", phone: "972529907316", uploaded: "all", ageDays: 3 },
  { name: "גיל פרץ", phone: "972544420078", uploaded: "all", stage2: true, ageDays: 0.8 },
  { name: "שירן מזרחי", phone: "972502261954", uploaded: 1, ageDays: 6.3 },
];

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const host = url.split("@")[1]?.split(/[:/]/)[0] ?? "";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error(`seed-clients-demo only runs against a local database (DATABASE_URL host is "${host || "missing"}").`);
  }
}

(async () => {
  assertLocalDatabase();
  const tenantId = process.env.DEV_TENANT_ID || (await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!tenantId) throw new Error("no tenant: run `npm run db:seed` first");
  const existing = await prisma.capabilityInstance.findFirst({ where: { tenantId, capabilityId: "documents" } });
  const config = { baseUrl: "https://www.snpv.co.il", rules: RULES };
  if (existing) await prisma.capabilityInstance.update({ where: { id: existing.id }, data: { config: config as Prisma.InputJsonValue, enabled: true } });
  else await prisma.capabilityInstance.create({ data: { tenantId, capabilityId: "documents", kind: "documents", config: config as Prisma.InputJsonValue } });

  const conv0 = await prisma.conversation.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  if (!conv0) throw new Error("need one conversation in the dev tenant: open /demo and send one message first");

  // Clean previous seed.
  await prisma.lead.deleteMany({ where: { tenantId, externalUserId: { startsWith: "seed-docs-" } } });

  for (const spec of SPECS) {
    const [first, last] = spec.name.split(" ");
    const at = new Date(Date.now() - spec.ageDays * 86_400_000);
    const lead = await prisma.lead.create({
      data: {
        tenantId,
        channelId: conv0.channelId,
        externalUserId: `seed-docs-${spec.phone}`,
        displayName: spec.name,
        pipelineStage: spec.pipeline ?? "talking",
        lastLeadMessageAt: at,
        lastOutboundAt: at,
        adminUnread: false,
        fields: { phone: spec.phone },
        createdAt: new Date(at.getTime() - 4 * 86_400_000),
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        leadId: lead.id,
        channelId: conv0.channelId,
        agentId: conv0.agentId,
        flowState: spec.task === "advisor" ? "waiting_human" : conv0.flowState,
        status: spec.task === "advisor" ? "waiting_human" : "open",
        flowVersion: conv0.flowVersion,
        createdAt: new Date(at.getTime() - 4 * 86_400_000),
      },
    });
    await prisma.message.createMany({
      data: [
        { tenantId, conversationId: conversation.id, role: "lead", text: "היי, קיבלתי הודעה לשלוח מסמכים למשכנתא", providerMessageId: `seed-${lead.id}-1`, createdAt: new Date(at.getTime() - 3600_000) },
        { tenantId, conversationId: conversation.id, role: "agent", text: "היי! אשמח לעזור. נתחיל מצילום של תעודת הזהות עם הספח.", providerMessageId: `seed-${lead.id}-2`, createdAt: at },
      ],
    });

    let profile = profileFor(first, last ?? "", spec.phone);
    if (spec.stage2) profile = { ...profile, releasedStageId: "2", checklistReviewOpened: true };
    let slots: SlotState[] = [];
    if (!spec.needsId) {
      const stage1 = checklistSlots({ ...profile, releasedStageId: "1" }, RULES);
      const dossier = freshDossier({ smartClientId: `smart-${spec.phone}`, profile, slots: stage1 });
      slots = dossier.slots;
      const n = spec.uploaded === "all" ? slots.length : spec.uploaded;
      slots = slots.map((slot, index) => index < n ? { ...slot, status: "uploaded" as const, filename: `${slot.docType}-${index}.pdf`, remoteId: `local:${slot.id}` } : slot);
      if (spec.rejectOne) {
        const i = slots.findIndex((slot) => slot.status === "missing");
        if (i >= 0) slots[i] = { ...slots[i], failCount: spec.task === "advisor" ? 5 : 1, lastReason: spec.rejectOne };
      }
      if (spec.stage2) {
        const stage2: SlotState[] = checklistSlots(profile, RULES).map((slot) => ({ ...slot, status: "missing" as const, failCount: 0, lastReason: "", remoteId: "", filename: "" }));
        stage2[0] = { ...stage2[0], status: "uploaded", filename: "purchase_contract.pdf", remoteId: "local:pc" };
        slots = [...slots, ...stage2];
      }
    }
    const done = dossierDone(slots);
    const row = await prisma.dossier.create({
      data: {
        tenantId,
        leadId: lead.id,
        conversationId: conversation.id,
        smartClientId: spec.needsId ? "" : `smart-${spec.phone}`,
        profile: (spec.needsId ? {} : { ...profile, ...(done && spec.task === "review" ? { checklistReviewOpened: true } : {}) }) as Prisma.InputJsonValue,
        slots: slots as unknown as Prisma.InputJsonValue,
        activeStage: activeStageOf(slots),
        status: spec.needsId ? "needs_id" : done ? "complete" : "gathering",
        createdAt: new Date(at.getTime() - 4 * 86_400_000),
      },
    });
    let minute = 0;
    for (const slot of slots) {
      if (slot.status !== "uploaded") continue;
      minute += 7;
      await prisma.leadDocument.create({
        data: {
          tenantId,
          leadId: lead.id,
          dossierId: row.id,
          docType: slot.docType,
          filename: slot.filename,
          mime: "application/pdf",
          status: "uploaded",
          remoteId: slot.remoteId,
          bytesEnc: await pdf(`${slot.docType} - ${spec.name.length} - ${slot.id}`),
          createdAt: new Date(at.getTime() - 3 * 3600_000 + minute * 60_000),
        },
      });
    }
    if (spec.rejectOne) {
      const slot = slots.find((s) => s.lastReason);
      if (slot) {
        await prisma.leadDocument.create({
          data: {
            tenantId, leadId: lead.id, dossierId: row.id, docType: slot.docType, filename: "IMG_2231.jpg", mime: "image/jpeg",
            status: "rejected", validation: { reason: spec.rejectOne } as Prisma.InputJsonValue, createdAt: at,
          },
        });
      }
    }
    if (spec.task) {
      await prisma.hitlTask.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          leadId: lead.id,
          type: "more_info",
          reason: spec.task === "review" ? "document_checklist_complete" : "document_review",
          payload: { summary: spec.taskSummary ?? "המסמכים התקבלו. לבדוק את התיק ואז לשחרר את השלב הבא.", kind: spec.task === "review" ? "checklist_complete" : "advisor_flag" },
          status: "open",
          createdAt: at,
        },
      });
    }
    console.log(spec.name, row.status, slots.length);
  }
  // CRM contacts for two clients, keyed by the same Smart NPV uuid as their file,
  // so the file shows CRM details. Campaign contacts are not listed on this screen.
  // A Smart NPV source with no key: nothing can be synced from it, it only labels the contacts.
  const source = await prisma.clientSource.upsert({
    where: { tenantId_kind: { tenantId, kind: "smartnpv" } },
    update: {},
    create: { tenantId, kind: "smartnpv", label: "Smart NPV", credentialsEnc: "", status: "ok", lastSyncAt: new Date() },
  });
  await prisma.contact.deleteMany({ where: { tenantId, OR: [{ externalId: { startsWith: "smart-" } }, { externalId: { startsWith: "seed-" } }] } });
  const linked = await prisma.lead.findMany({ where: { tenantId, externalUserId: { in: ["seed-docs-972521234567", "seed-docs-972547771203"] } } });
  for (const [i, lead] of linked.entries()) {
    const phone = lead.externalUserId.replace("seed-docs-", "");
    await prisma.contact.create({
      data: {
        tenantId,
        sourceId: source.id,
        externalId: `smart-${phone}`,
        name: lead.displayName ?? "",
        phone,
        phoneStatus: "ok",
        leadId: lead.id,
        dealDate: new Date(Date.UTC(2026, 9 - i, 1)),
        dealDateSource: "client_contract_date",
        dealDateConfidence: "medium",
        mapped: { transaction_bank: ["לאומי", "הפועלים"][i % 2], status_id: "12", status_title: "בטיפול", archive: "0" },
      },
    });
  }
  console.log(`Seeded ${SPECS.length} clients on tenant ${tenantId}. Open /clients.`);
  await prisma.$disconnect();
})();
