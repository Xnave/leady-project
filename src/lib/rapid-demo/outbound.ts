import { replyLang } from "@/lib/copy";
import {
  decorateRapidDemoText,
  hitlNoticeText,
  type DemoLang,
} from "./copy";

export { decorateRapidDemoText };

/** Production turns skip the HITL-notice query unless this lead is a rapid demo. */
export function turnNeedsDemoNotice(fields: { rapidDemo?: unknown } | null | undefined): boolean {
  return fields?.rapidDemo === true;
}

const KIND_LABEL: Record<string, Record<DemoLang, string>> = {
  visit: { he: "פגישה", en: "visit" },
  stay: { he: "אירוח", en: "stay" },
};

export function formatHitlTaskLine(
  task: { type: string; reason: string; payload: unknown },
  lang: DemoLang = "en",
): string {
  const payload =
    task.payload && typeof task.payload === "object" && !Array.isArray(task.payload)
      ? (task.payload as Record<string, unknown>)
      : {};
  const rawKind = typeof payload.kind === "string" && payload.kind.trim() ? payload.kind.trim() : task.type;
  const kind = KIND_LABEL[rawKind]?.[lang] ?? rawKind;
  const time = typeof payload.timeText === "string" ? payload.timeText.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
  const reason = task.reason && task.reason !== task.type && task.reason !== rawKind ? task.reason : "";
  return [kind, time, name, summary || reason].filter(Boolean).join(" · ");
}

export function hitlNotice(lang: DemoLang, tasks: { type: string; reason: string; payload: unknown }[]): string {
  return hitlNoticeText(lang, tasks.map((task) => formatHitlTaskLine(task, lang)));
}

/** After a production turn, tell the demo visitor about HITL tasks that turn opened. */
export async function notifyRapidDemoHitl(opts: {
  tenantId: string;
  conversationId: string;
  triggerMessageId?: string;
  since: Date;
}): Promise<void> {
  try {
    const { prisma } = await import("@/lib/db");
    const convo = await prisma.conversation.findFirst({
      where: { id: opts.conversationId, tenantId: opts.tenantId },
      select: { leadId: true, lead: { select: { fields: true } } },
    });
    if (!convo) return;
    const fields = (convo.lead.fields ?? {}) as Record<string, unknown>;
    if (fields.rapidDemo !== true) return;

    let since = opts.since;
    if (opts.triggerMessageId) {
      const trigger = await prisma.message.findFirst({
        where: { id: opts.triggerMessageId, tenantId: opts.tenantId },
        select: { createdAt: true },
      });
      if (trigger) since = trigger.createdAt;
    }

    const tasks = await prisma.hitlTask.findMany({
      where: {
        tenantId: opts.tenantId,
        leadId: convo.leadId,
        status: "open",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "asc" },
    });
    if (tasks.length === 0) return;

    const { loadTurnContext } = await import("@/lib/conversations");
    const { sendAndSave } = await import("@/lib/flow/run-turn");
    const ctx = await loadTurnContext(opts.tenantId, opts.conversationId);
    const lastLead = [...ctx.messages].reverse().find((message) => message.role === "lead")?.text ?? "";
    const lines = tasks.map((task) => formatHitlTaskLine(task, replyLang(ctx, lastLead)));
    await sendAndSave(ctx, hitlNoticeText(replyLang(ctx, lastLead), lines), {
      idempotencyKey: `hitl-${tasks.map((task) => task.id).join("-")}`,
    });
  } catch (err) {
    console.warn(JSON.stringify({ msg: "rapid_demo.hitl_notice_failed", error: String(err) }));
  }
}
