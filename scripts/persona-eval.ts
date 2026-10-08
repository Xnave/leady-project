/**
 * Persona eval: runs scripted customer conversations through the real interpreter + LLM
 * for a baseline (legacy prompt) and each persona preset, then grades every agent reply
 * with an LLM judge. Local only — costs LLM calls; never part of `npm test`.
 *
 *   npx tsx scripts/persona-eval.ts [--arms legacy,warm_concierge,...] [--only he-price,en-book]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { interpretTurn } from "@/lib/flow/interpreter";
import { answerFaq, classifyIntent, draftQuestion, extractFields, talkTurn } from "@/lib/flow/llm";
import { llmConfigured } from "@/lib/flow/model";
import type { TurnContext } from "@/lib/flow/types";
import { DEFAULT_PERSONA, PRESETS, applyPreset, type BuiltinPresetId } from "@/lib/persona/presets";
import type { Persona } from "@/lib/persona/types";
import { KNOWLEDGE, fixtureAgent, fixtureTenant } from "./persona-eval/fixture";
import { judge, type Score } from "./persona-eval/judge";
import { SCENARIOS, type Scenario } from "./persona-eval/scenarios";

type Arm = "legacy" | BuiltinPresetId;
type Turn = { customer: string; reply: string; score: Score | null; error?: string };
type Result = { arm: Arm; scenario: string; lang: string; turns: Turn[] };

function arg(name: string): string[] | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]?.split(",").filter(Boolean) : undefined;
}

const ARMS = (arg("arms") ?? ["legacy", "warm_concierge", "precise_short", "premium_formal"]) as Arm[];
for (const a of ARMS) {
  if (a !== "legacy" && !(a in PRESETS)) {
    console.error(`Unknown arm "${a}". Use legacy or one of: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }
}
const ONLY = arg("only");

/**
 * legacy and warm_concierge both use DEFAULT_PERSONA (what every existing tenant gets: no name,
 * neutral gender), so the headline before/after compares like with like. The other presets
 * exercise named female and male agents so Hebrew gender is measured in all three forms.
 */
function personaFor(arm: Arm): Persona {
  if (arm === "legacy" || arm === "warm_concierge") return DEFAULT_PERSONA;
  if (arm === "premium_formal") return applyPreset(arm, { agentName: "דניאל", gender: "male", rules: [] });
  return applyPreset(arm, { agentName: "נועה", gender: "female", rules: [] });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt >= 4 || !/quota|rate|429|exhausted/i.test(msg)) throw e;
      console.warn(`  ${label}: rate limited, retry ${attempt} in ${attempt * 20}s`);
      await sleep(attempt * 20_000);
    }
  }
}

function freshCtx(persona: Persona): TurnContext {
  const agent = fixtureAgent(persona);
  return {
    tenantId: "eval",
    tenant: fixtureTenant,
    agent,
    conversation: { id: "eval", status: "open", flowState: agent.flow.start, flowVersion: 1, nudgeCountByStage: {} },
    lead: { id: "eval-lead", externalUserId: "eval-user", fields: {} },
    messages: [],
    channel: { provider: "whatsapp" },
  };
}

async function runScenario(arm: Arm, sc: Scenario): Promise<Result> {
  if (arm === "legacy") process.env.PROMPT_PIPELINE = "legacy";
  else delete process.env.PROMPT_PIPELINE;
  const persona = personaFor(arm);
  const ctx = freshCtx(persona);
  const turns: Turn[] = [];

  for (const line of sc.customer) {
    ctx.messages.push({ role: "lead", text: line });
    const snapshot = structuredClone({ conversation: ctx.conversation, lead: ctx.lead, messages: ctx.messages });
    let sent: string[] = [];
    let degraded = false;
    await withRetry(
      () => {
        // A retry must replay the same turn, not continue from a half-applied one.
        Object.assign(ctx, structuredClone(snapshot));
        sent = [];
        degraded = false;
        return interpretTurn(ctx, {}, {
          classify: classifyIntent,
          extract: extractFields,
          draftQuestion,
          answerFaq,
          talk: async (c, stage) => {
            const out = await talkTurn(c, stage);
            if (out.effects?.some((e) => e.args?.reason === "llm_unavailable")) degraded = true;
            return out;
          },
          runEffect: async (_c, effectId) => ({ ok: true, reply: `${effectId} recorded` }),
          requestHuman: async () => {
            ctx.conversation.status = "waiting_human";
          },
          persistStage: async (_c, id) => {
            ctx.conversation.flowState = id;
          },
          persistFields: async (_c, fields) => {
            ctx.lead.fields = fields;
          },
          sendAndSave: async (_c, text) => {
            sent.push(text);
            ctx.messages.push({ role: "agent", text });
          },
          scheduleNudge: async () => undefined,
          log: () => undefined,
        });
      },
      `${arm}/${sc.id}`,
    );
    const reply = sent.join("\n");
    if (degraded) {
      turns.push({ customer: line, reply, score: null, error: "LLM unavailable (quota/rate limit) — talk degraded" });
      continue;
    }
    if (!sent.length) {
      turns.push({ customer: line, reply: "", score: null, error: "no reply sent (hand-off or waiting for a human)" });
      continue;
    }
    const transcript = ctx.messages.slice(0, -sent.length || undefined).map((m) => ({ role: m.role, text: m.text }));
    const score = await withRetry(
      () => judge({ persona, lang: sc.lang, knowledge: KNOWLEDGE, expect: sc.expect, transcript, reply }),
      `judge ${arm}/${sc.id}`,
    ).catch((e) => {
      turns.push({ customer: line, reply, score: null, error: `judge failed: ${String(e).slice(0, 120)}` });
      return null;
    });
    if (score) turns.push({ customer: line, reply, score });
  }
  return { arm, scenario: sc.id, lang: sc.lang, turns };
}

const METRICS = ["human", "personaMatch", "helpful", "length", "hebrewGender"] as const;

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function summarize(results: Result[]) {
  const byArm: Record<string, Record<string, number | null> & { rulesPct: number | null; graded: number; failed: number }> = {};
  for (const arm of ARMS) {
    const turns = results.filter((r) => r.arm === arm).flatMap((r) => r.turns);
    const scored = turns.map((t) => t.score).filter((s): s is Score => Boolean(s));
    const row: Record<string, number | null> = {};
    for (const m of METRICS) {
      row[m] = avg(scored.map((s) => s[m]).filter((v): v is number => typeof v === "number"));
    }
    byArm[arm] = {
      ...row,
      rulesPct: scored.length ? (100 * scored.filter((s) => s.rulesRespected).length) / scored.length : null,
      graded: scored.length,
      failed: turns.length - scored.length,
    };
  }
  return byArm;
}

const fmt = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

function scorecard(sum: ReturnType<typeof summarize>): string {
  const head = `| metric | ${ARMS.join(" | ")} |\n|---|${ARMS.map(() => "---").join("|")}|`;
  const rows = [
    ...METRICS.map((m) => `| ${m} | ${ARMS.map((a) => fmt(sum[a]?.[m])).join(" | ")} |`),
    `| rulesRespected % | ${ARMS.map((a) => fmt(sum[a]?.rulesPct, 0)).join(" | ")} |`,
    `| graded / not graded | ${ARMS.map((a) => `${sum[a]?.graded ?? 0} / ${sum[a]?.failed ?? 0}`).join(" | ")} |`,
  ];
  const checks: string[] = [];
  const L = sum.legacy;
  const W = sum.warm_concierge;
  const pass = (ok: boolean | null) => (ok == null ? "N/A" : ok ? "PASS" : "FAIL");
  if (L && W) {
    for (const m of ["human", "helpful"] as const) {
      const ok = L[m] != null && W[m] != null ? (W[m] as number) - (L[m] as number) >= 0.5 : null;
      checks.push(`- warm_concierge − legacy on ${m} ≥ +0.5: ${fmt(W[m] != null && L[m] != null ? (W[m] as number) - (L[m] as number) : null)} → ${pass(ok)}`);
    }
    checks.push(`- rulesRespected ≥ legacy: ${fmt(W.rulesPct, 0)}% vs ${fmt(L.rulesPct, 0)}% → ${pass(W.rulesPct != null && L.rulesPct != null ? W.rulesPct >= L.rulesPct : null)}`);
  }
  for (const a of ARMS.filter((x) => x !== "legacy")) {
    const s = sum[a];
    checks.push(`- ${a} personaMatch ≥ 4.0 (${fmt(s.personaMatch)}) → ${pass(s.personaMatch == null ? null : (s.personaMatch as number) >= 4)}; length ≥ 4.0 (${fmt(s.length)}) → ${pass(s.length == null ? null : (s.length as number) >= 4)}; hebrewGender ≥ 4.5 (${fmt(s.hebrewGender)}) → ${pass(s.hebrewGender == null ? null : (s.hebrewGender as number) >= 4.5)}`);
  }
  return `${head}\n${rows.join("\n")}\n\n**Acceptance**\n${checks.join("\n")}\n`;
}

function transcripts(results: Result[]): string {
  const out: string[] = [];
  for (const sc of SCENARIOS.filter((s) => !ONLY || ONLY.includes(s.id))) {
    out.push(`## ${sc.id}\n_${sc.expect}_\n`);
    for (const arm of ARMS) {
      const r = results.find((x) => x.arm === arm && x.scenario === sc.id);
      if (!r) continue;
      out.push(`### ${arm}`);
      for (const t of r.turns) {
        const s = t.score;
        out.push(
          `> **customer:** ${t.customer}\n>\n> **agent:** ${t.reply.replace(/\n/g, "\n> ")}\n`,
          s
            ? `\`human ${s.human} · persona ${s.personaMatch} · helpful ${s.helpful} · length ${s.length} · gender ${s.hebrewGender ?? "—"} · rules ${s.rulesRespected ? "ok" : "VIOLATION"}\` ${s.note}\n`
            : `\`not graded: ${t.error}\`\n`,
        );
      }
    }
  }
  return out.join("\n");
}

async function main() {
  if (!llmConfigured()) {
    console.error("No LLM key configured (.env). The eval needs a real model.");
    process.exit(1);
  }
  ensureFlowRegistry();
  const scenarios = SCENARIOS.filter((s) => !ONLY || ONLY.includes(s.id));
  const dir = join("eval-out", `persona-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  const results: Result[] = [];
  for (const arm of ARMS) {
    for (const sc of scenarios) {
      process.stdout.write(`${arm} / ${sc.id} … `);
      try {
        const r = await runScenario(arm, sc);
        results.push(r);
        console.log(r.turns.map((t) => (t.score ? "✓" : "✗")).join(""));
      } catch (e) {
        console.log(`error: ${String(e).slice(0, 160)}`);
        // Count every expected turn as not graded so a crash can't make the scorecard look clean.
        results.push({
          arm,
          scenario: sc.id,
          lang: sc.lang,
          turns: sc.customer.map((customer) => ({ customer, reply: "", score: null, error: `scenario crashed: ${String(e).slice(0, 120)}` })),
        });
      }
      writeFileSync(join(dir, "raw.json"), JSON.stringify(results, null, 2));
    }
  }
  const sum = summarize(results);
  writeFileSync(join(dir, "scorecard.md"), scorecard(sum));
  writeFileSync(join(dir, "transcripts.md"), transcripts(results));
  console.log(`\n${scorecard(sum)}\nWritten to ${dir}`);
}

void main();
