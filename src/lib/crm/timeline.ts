/**
 * Pure activity-timeline builder for a lead. No Prisma, no business domain
 * names — see architecture.test.ts ("crm purity").
 */
export type TimelineKind = "stage" | "note" | "next_step" | "snooze" | "request" | "handoff" | "conversation";
export type TimelineItem = { id: string; at: Date; kind: TimelineKind; data: Record<string, unknown> };

export type TimelineSources = {
  stageEvents: { id: string; from: string; to: string; source: string; reason: string; actorUserId: string | null; createdAt: Date }[];
  notes: { id: string; body: string; authorLabel: string; pinned: boolean; createdAt: Date }[];
  decisions: { id: string; category: string; action: string; actorUserId?: string | null; actorLabel: string; details: unknown; createdAt: Date }[];
  requests: { id: string; kind: string; status: string; timeText: string; createdAt: Date }[];
  handoffs: { id: string; reason: string; status: string; createdAt: Date; completedAt: Date | null }[];
  conversations: { id: string; status: string; lifecycleReason: string; createdAt: Date; updatedAt: Date }[];
};

export function buildLeadTimeline(src: TimelineSources): TimelineItem[] {
  const items: TimelineItem[] = [];
  // Stage events keep only the actor's id; the label comes from that actor's decisions.
  const actorLabels = new Map<string, string>();
  for (const d of src.decisions) if (d.actorUserId && !actorLabels.has(d.actorUserId)) actorLabels.set(d.actorUserId, d.actorLabel);
  for (const e of src.stageEvents) {
    const actor = e.actorUserId ? (actorLabels.get(e.actorUserId) ?? "") : "";
    items.push({ id: `stage-${e.id}`, at: e.createdAt, kind: "stage", data: { from: e.from, to: e.to, source: e.source, reason: e.reason, actor } });
  }
  for (const n of src.notes) {
    items.push({ id: `note-${n.id}`, at: n.createdAt, kind: "note", data: { body: n.body, author: n.authorLabel } });
  }
  for (const d of src.decisions) {
    if (d.category === "lead" && (d.action === "next_step_set" || d.action === "next_step_done")) {
      items.push({ id: `dec-${d.id}`, at: d.createdAt, kind: "next_step", data: { action: d.action, actor: d.actorLabel, ...(d.details as object) } });
    } else if (d.category === "lead" && d.action === "snooze") {
      items.push({ id: `dec-${d.id}`, at: d.createdAt, kind: "snooze", data: { actor: d.actorLabel, ...(d.details as object) } });
    } else if (d.category === "request") {
      items.push({ id: `dec-${d.id}`, at: d.createdAt, kind: "request", data: { event: d.action, actor: d.actorLabel } });
    }
  }
  for (const r of src.requests) {
    items.push({ id: `req-${r.id}`, at: r.createdAt, kind: "request", data: { event: "created", kind: r.kind, timeText: r.timeText } });
  }
  for (const h of src.handoffs) {
    items.push({ id: `hitl-${h.id}`, at: h.createdAt, kind: "handoff", data: { event: "opened", reason: h.reason } });
    if (h.completedAt) items.push({ id: `hitl-done-${h.id}`, at: h.completedAt, kind: "handoff", data: { event: "resolved" } });
  }
  for (const c of src.conversations) {
    items.push({ id: `convo-${c.id}`, at: c.createdAt, kind: "conversation", data: { event: "started", conversationId: c.id } });
    if (c.status === "closed") {
      items.push({ id: `convo-end-${c.id}`, at: c.updatedAt, kind: "conversation", data: { event: "ended", reason: c.lifecycleReason, conversationId: c.id } });
    }
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function groupTimelineByDay(items: TimelineItem[], tz: string): { day: string; items: TimelineItem[] }[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const groups: { day: string; items: TimelineItem[] }[] = [];
  for (const it of items) {
    const day = fmt.format(it.at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }
  return groups;
}
