import type { CheckResult, ScenarioPhaseExpect, ScenarioSnapshot } from "./types";

const HEBREW = /[\u0590-\u05FF]/g;
const LATIN = /[A-Za-z]/g;

const MALE_SELF = [/אני יכול(?!ה)/, /אני שמח(?!ה)/, /העוזר הדיגיטלי/];
const FEMALE_SELF = [/אני יכולה/, /אני שמחה/, /העוזרת הדיגיטלית/];

export function predominantlyHebrew(text: string): boolean {
  const prose = text.replace(/https?:\/\/\S+/gi, " ");
  const hebrew = prose.match(HEBREW)?.length ?? 0;
  const latin = prose.match(LATIN)?.length ?? 0;
  if (hebrew === 0) return false;
  return hebrew >= latin;
}

/** Warnings only. Empty when the persona gender is unknown. */
export function genderWarnings(text: string, gender: "female" | "male" | ""): string[] {
  if (!gender) return [];
  const patterns = gender === "female" ? MALE_SELF : FEMALE_SELF;
  return patterns
    .map((pattern) => text.match(pattern)?.[0])
    .filter((hit): hit is string => Boolean(hit))
    .map((hit) => `Persona is ${gender}; reply contains "${hit}".`);
}

function filled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function evaluateScenario(
  snapshot: ScenarioSnapshot,
  expect: ScenarioPhaseExpect,
  opts: { phase: string; capability: string; previousConversationId?: string },
): CheckResult[] {
  const phase = opts.phase;
  const checks: CheckResult[] = [];
  const requests = snapshot.requests.filter((request) => request.capabilityId === opts.capability);
  const approvalOpen = snapshot.hitl.some((task) => task.status === "open" && task.type === "request_approval");

  if (expect.request) {
    const ok =
      expect.request === "none"
        ? requests.length === 0
        : requests.some((request) => request.status === expect.request);
    checks.push({
      name: `${phase}: request ${expect.request}`,
      ok,
      detail: requests.map((request) => request.status).join(", ") || "none",
    });
  }
  if (expect.requestStartsOn) {
    const wanted = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(
      expect.requestStartsOn,
    );
    const dates = requests
      .map((request) => request.timeText.match(/\d{4}-\d{2}-\d{2}/)?.[0])
      .filter((iso): iso is string => Boolean(iso));
    const matched = dates.some((iso) => {
      const [year, month, day] = iso.split("-").map(Number);
      return new Date(year!, month! - 1, day).getDay() === wanted;
    });
    checks.push({
      name: `${phase}: stay starts on ${expect.requestStartsOn}`,
      ok: matched,
      detail: dates.join(", ") || "no date",
    });
  }
  if (expect.requestNot) {
    const hit = requests.some((request) => request.status === expect.requestNot);
    checks.push({
      name: `${phase}: request is not ${expect.requestNot}`,
      ok: !hit,
      detail: requests.map((request) => request.status).join(", ") || "none",
    });
  }
  if (expect.hitlOpen != null) {
    checks.push({
      name: `${phase}: approval task ${expect.hitlOpen ? "open" : "closed"}`,
      ok: approvalOpen === expect.hitlOpen,
      detail: approvalOpen ? "open" : "none",
    });
  }
  if (expect.handoff) {
    const handoff =
      snapshot.status === "waiting_human" ||
      snapshot.hitl.some((task) => task.status === "open" && task.type === "more_info");
    checks.push({
      name: `${phase}: handoff`,
      ok: handoff,
      detail: snapshot.status,
    });
  }
  if (expect.conversationStatus) {
    checks.push({
      name: `${phase}: status ${expect.conversationStatus}`,
      ok: snapshot.status === expect.conversationStatus,
      detail: snapshot.status,
    });
  }
  for (const key of expect.crmPresent ?? []) {
    checks.push({
      name: `${phase}: crm ${key}`,
      ok: filled(snapshot.crm[key]),
      detail: filled(snapshot.crm[key]) ? "set" : "missing",
    });
  }
  for (const key of expect.sessionPresent ?? []) {
    const present = filled(snapshot.session[key]) || filled(snapshot.crm[key]);
    checks.push({
      name: `${phase}: captured ${key}`,
      ok: present,
      detail: present ? "set" : "missing",
    });
  }
  for (const key of expect.sessionAbsent ?? []) {
    const present = filled(snapshot.session[key]) || filled(snapshot.crm[key]);
    checks.push({
      name: `${phase}: session cleared ${key}`,
      ok: !present,
      detail: present ? "still set" : "cleared",
    });
  }
  if (expect.sessionEmpty) {
    const keys = Object.keys(snapshot.session).filter((key) => filled(snapshot.session[key]));
    checks.push({
      name: `${phase}: session empty`,
      ok: keys.length === 0,
      detail: keys.join(", ") || "empty",
    });
  }
  if (expect.freshConversation) {
    const changed = Boolean(opts.previousConversationId) && snapshot.conversationId !== opts.previousConversationId;
    checks.push({
      name: `${phase}: new conversation`,
      ok: changed,
      detail: snapshot.conversationId,
    });
  }
  if (expect.replyAvoids?.length) {
    const last = lastAgentReply(snapshot);
    const hit = expect.replyAvoids.find((phrase) => last.includes(phrase));
    checks.push({
      name: `${phase}: last reply does not re-ask`,
      ok: Boolean(last) && !hit,
      detail: hit ? `contains "${hit}"` : last ? "ok" : "no agent reply",
    });
  }
  if (expect.replyIncludes?.length) {
    const last = lastAgentReply(snapshot);
    const missing = expect.replyIncludes.find((phrase) => !last.includes(phrase));
    checks.push({
      name: `${phase}: last reply includes a link`,
      ok: Boolean(last) && !missing,
      detail: missing ? `missing "${missing}"` : "ok",
    });
  }
  return checks;
}

function lastAgentReply(snapshot: ScenarioSnapshot): string {
  for (let i = snapshot.messages.length - 1; i >= 0; i--) {
    const message = snapshot.messages[i];
    if (message?.conversationId === snapshot.conversationId && message.role === "agent") return message.text;
  }
  return "";
}

/** One pass over the whole transcript. Identical consecutive agent replies in the same thread fail. */
export function replyChecks(snapshot: ScenarioSnapshot): CheckResult[] {
  const byConversation = new Map<string, string[]>();
  for (const message of snapshot.messages) {
    if (message.role !== "agent") continue;
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message.text);
    byConversation.set(message.conversationId, list);
  }
  const agentTexts = [...byConversation.values()].flat();
  const hebrew = agentTexts.length > 0 && agentTexts.every((text) => predominantlyHebrew(text));
  let repeated = false;
  for (const texts of byConversation.values()) {
    for (let i = 1; i < texts.length; i++) {
      if (texts[i]?.trim() && texts[i]?.trim() === texts[i - 1]?.trim()) repeated = true;
    }
  }
  return [
    {
      name: "hebrew replies",
      ok: hebrew,
      detail: agentTexts.length === 0 ? "no agent reply" : hebrew ? "hebrew" : "not hebrew",
    },
    {
      name: "no repeated reply",
      ok: !repeated,
      detail: repeated ? "two identical replies" : "ok",
    },
  ];
}
