/**
 * Hebrew conversation scenarios against a running app. Not part of `npm test`.
 *
 *   npm run dev
 *   npm run scenarios
 *   npm run scenarios -- --only booking-bad-time
 *   npm run scenarios -- --suite full
 *   npm run scenarios -- --suite link
 *   npm run scenarios -- --due
 *   npm run scenarios -- --sample 2
 *   npm run scenarios -- --purge
 *   npm run scenarios -- --purge-before YYYY-MM-DD
 *   npm run scenarios -- --purge-lead <leadId>
 *
 * Local is the default (`http://localhost:3000`). Set `SCENARIO_RUNNER_SECRET` in `.env`
 * (the dev server reads the same file). Booking uses `SCENARIO_BOOKING_TENANT_ID` or
 * `DEV_TENANT_ID`. Reservations run only when `SCENARIO_RESERVATION_TENANT_ID` is set.
 * The link suite (`--suite link`) uses `SCENARIO_RESERVATION_LINK_TENANT_ID` and is not part of smoke.
 *
 * Production is opt-in:
 *   npm run scenarios -- --base-url https://app.zapidly.com
 *   npm run scenarios -- --base-url https://app.zapidly.com --live --tenant <id>
 *
 * The server must pin `SCENARIO_CANARY_BOOKING_TENANT_ID` and
 * `SCENARIO_CANARY_RESERVATION_TENANT_ID`. A live tenant also has to be listed in
 * `SCENARIO_TENANT_ALLOWLIST`.
 *
 * Each run writes `scenario-runs/test-conversations-YYYY-MM-DD-HHmm.md`.
 * A new scenario is an object in `scenarios/booking.ts` or `scenarios/reservations.ts`.
 * Extra ideas that are not executed live in `catalog.md`; copy one in and mark it
 * `primary` or `sample` to run it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { genderWarnings, replyChecks, evaluateScenario } from "@/lib/scenarios/expect";
import { readScenarioEnv } from "@/lib/scenarios/guard";
import { renderReview, type ReviewSection } from "@/lib/scenarios/review";
import { parseScenarioBefore } from "@/lib/scenarios/guard";
import { conversationLink, mergeResults, parseResults, scenarioDue, type ResultRow } from "@/lib/scenarios/results";
import { planRuns } from "@/lib/scenarios/select";
import type {
  CheckResult,
  Scenario,
  ScenarioCapability,
  ScenarioPhaseExpect,
  ScenarioSnapshot,
  ScenarioTarget,
} from "@/lib/scenarios/types";
import { SCENARIOS } from "./scenarios";

const ENV_KEYS = [
  "SCENARIO_RUNNER_SECRET",
  "SCENARIO_BOOKING_TENANT_ID",
  "SCENARIO_RESERVATION_TENANT_ID",
  "SCENARIO_RESERVATION_LINK_TENANT_ID",
  "SCENARIO_CANARY_BOOKING_TENANT_ID",
  "SCENARIO_CANARY_RESERVATION_TENANT_ID",
  "SCENARIO_TENANT_ALLOWLIST",
  "DEV_TENANT_ID",
] as const;

function loadDotEnv() {
  let text = "";
  try {
    text = readFileSync(join(process.cwd(), ".env"), "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!value || process.env[key]) continue;
    if ((ENV_KEYS as readonly string[]).includes(key)) process.env[key] = value;
  }
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function stamp(date: Date): { heading: string; file: string } {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hm = `${pad(date.getHours())}${pad(date.getMinutes())}`;
  return {
    heading: `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
    file: `${day}-${hm}`,
  };
}

type SendResult = { answered: boolean; snapshot: ScenarioSnapshot };
type DecideResult = { snapshot: ScenarioSnapshot };

async function post(baseUrl: string, secret: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(new URL("/api/ops/scenarios", baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `http_${response.status}`);
  return payload;
}

function mergeExpect(base: ScenarioPhaseExpect, extra?: ScenarioPhaseExpect): ScenarioPhaseExpect {
  return { ...base, ...extra };
}

function reviewText(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join("\n\n");
}

async function play(opts: {
  baseUrl: string;
  secret: string;
  target: ScenarioTarget;
  tenantId?: string;
  scenario: Scenario;
  variantTurns: string[];
  variantExpect?: ScenarioPhaseExpect;
  runId: string;
}): Promise<{ checks: CheckResult[]; warnings: string[]; snapshot?: ScenarioSnapshot; skip?: string }> {
  const checks: CheckResult[] = [];
  let snapshot: ScenarioSnapshot | undefined;
  let leadId: string | undefined;
  const { scenario } = opts;
  const phaseExpect = mergeExpect(scenario.expect, opts.variantExpect);

  const send = async (text: string) => {
    const result = (await post(opts.baseUrl, opts.secret, {
      action: "send",
      target: opts.target,
      capability: scenario.capability,
      tenantId: opts.tenantId,
      text,
      leadId,
      scenarioId: scenario.id,
      runId: opts.runId,
    })) as SendResult;
    snapshot = result.snapshot;
    leadId = result.snapshot.leadId;
    if (!result.answered) checks.push({ name: "agent replied", ok: false, detail: text });
  };

  const warnings: string[] = [];
  try {
    for (const text of opts.variantTurns) await send(text);
    if (snapshot) {
      checks.push(
        ...evaluateScenario(snapshot, phaseExpect, { phase: "after turns", capability: scenario.capability }),
      );
    }

    if (scenario.decide) {
      const pending = snapshot?.requests.find(
        (request) => request.capabilityId === scenario.capability && request.status === "pending",
      );
      if (!pending) {
        checks.push({ name: "decide", ok: false, detail: "no pending request" });
      } else {
        const decided = (await post(opts.baseUrl, opts.secret, {
          action: "decide",
          target: opts.target,
          capability: scenario.capability,
          tenantId: opts.tenantId,
          requestId: pending.id,
          decision: scenario.decide.decision,
          alternativeStart: scenario.decide.alternativeStart,
          alternativeEnd: scenario.decide.alternativeEnd,
        })) as DecideResult;
        snapshot = decided.snapshot;
        if (scenario.decide.then) {
          checks.push(
            ...evaluateScenario(snapshot, scenario.decide.then, {
              phase: `after ${scenario.decide.decision}`,
              capability: scenario.capability,
            }),
          );
        }
      }
    }

    if (scenario.followUp && leadId) {
      for (const text of scenario.followUp.turns) await send(text);
      if (snapshot && scenario.followUp.expect) {
        checks.push(
          ...evaluateScenario(snapshot, scenario.followUp.expect, {
            phase: "after follow-up",
            capability: scenario.capability,
          }),
        );
      }
    }

    if (scenario.endThen && leadId && snapshot) {
      const previousConversationId = snapshot.conversationId;
      snapshot = (
        (await post(opts.baseUrl, opts.secret, {
          action: "end",
          target: opts.target,
          capability: scenario.capability,
          tenantId: opts.tenantId,
          leadId,
        })) as DecideResult
      ).snapshot;
      for (const text of scenario.endThen.turns) await send(text);
      if (snapshot && scenario.endThen.expect) {
        checks.push(
          ...evaluateScenario(snapshot, scenario.endThen.expect, {
            phase: "after fresh thread",
            capability: scenario.capability,
            previousConversationId,
          }),
        );
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail === "missing_tenant" || detail === "missing_canary") {
      return { checks, warnings, snapshot, skip: detail };
    }
    checks.push({ name: "run", ok: false, detail });
  }

  if (snapshot) {
    checks.push(...replyChecks(snapshot));
    for (const message of snapshot.messages) {
      if (message.role !== "agent") continue;
      warnings.push(...genderWarnings(message.text, snapshot.personaGender));
    }
  }
  return { checks, warnings, snapshot };
}

function resultRow(
  run: { scenario: { id: string; cadenceDays?: number }; variant: { id: string } },
  lastRun: string,
  result: ResultRow["result"],
  wrong: string,
): ResultRow {
  return {
    scenario: run.scenario.id,
    variant: run.variant.id,
    cadence: run.scenario.cadenceDays ? `${run.scenario.cadenceDays}d` : "",
    lastRun,
    result,
    wrong,
  };
}

function localTenant(
  scenario: { capability: ScenarioCapability; pool?: "link" },
  booking: string,
  reservation: string,
  link: string,
): string | undefined {
  if (scenario.capability === "booking") return booking || undefined;
  if (scenario.pool === "link") return link || undefined;
  return reservation || undefined;
}

async function main() {
  loadDotEnv();
  const baseUrl = option("base-url") ?? "http://localhost:3000";
  const suite = option("suite") ?? "smoke";
  if (suite !== "smoke" && suite !== "full" && suite !== "link" && suite !== "extra") {
    console.error('Suite must be "smoke", "full", "link", or "extra".');
    process.exit(1);
  }
  const dueOnly = process.argv.includes("--due");
  const only = option("only")?.split(",").map((id) => id.trim()).filter(Boolean);
  const sample = Number(option("sample") ?? "0");
  const live = process.argv.includes("--live");
  const liveTenant = option("tenant");
  const purgeLead = option("purge-lead");
  const purgeBefore = option("purge-before");
  const purge = process.argv.includes("--purge") || Boolean(purgeLead) || Boolean(purgeBefore);
  const hostname = new URL(baseUrl).hostname;
  const localHost = hostname === "localhost" || hostname === "127.0.0.1";
  const target: ScenarioTarget = live ? "live" : localHost ? "local" : "canary";
  const env = readScenarioEnv(process.env, false);
  const secret = env.secret;
  if (!secret) {
    console.error("Set SCENARIO_RUNNER_SECRET in .env. The dev server reads the same value.");
    process.exit(1);
  }
  if (live && !liveTenant) {
    console.error("A live run needs --tenant <id>, and that id must be on the server allowlist.");
    process.exit(1);
  }

  if (purge) {
    if (purgeLead && purgeBefore) {
      console.error("Pass either --purge-lead or --purge-before, not both.");
      process.exit(1);
    }
    if (purgeBefore && !parseScenarioBefore(purgeBefore)) {
      console.error("--purge-before needs a date, YYYY-MM-DD.");
      process.exit(1);
    }
    const result = (await post(baseUrl, secret, {
      action: "purge",
      target,
      tenantId: target === "live" ? liveTenant : undefined,
      leadId: purgeLead,
      before: purgeBefore,
    })) as { deleted?: number };
    console.log(`Deleted ${result.deleted ?? 0} scenario lead${result.deleted === 1 ? "" : "s"}.`);
    return;
  }

  const bookingTenant = env.bookingTenantId || env.devTenantId;
  const reservationTenant = env.reservationTenantId;
  const linkTenant = env.reservationLinkTenantId;
  const resultsPath = join(process.cwd(), "scripts/agent-scenarios/results.md");
  const previousResults = existsSync(resultsPath) ? readFileSync(resultsPath, "utf8") : "";
  const knownResults = parseResults(previousResults);
  const now = new Date();
  const { runs, unknownIds } = planRuns(SCENARIOS, {
    suite,
    only,
    sample: Number.isFinite(sample) ? sample : 0,
  });
  const blocked = new Set<ScenarioCapability>();
  const sections: ReviewSection[] = [];
  const recorded: ResultRow[] = [];

  if (unknownIds.length > 0) {
    sections.push({
      title: "Unknown scenario ids",
      checks: unknownIds.map((id) => ({ name: id, ok: false, detail: "no such scenario" })),
      warnings: [],
      messages: [],
    });
  }

  for (const run of runs) {
    const title = `${run.scenario.id} · ${run.variant.id}${run.sampled ? " (sample)" : ""}`;
    if (
      dueOnly &&
      !scenarioDue(
        run.scenario.cadenceDays,
        knownResults.find((row) => row.scenario === run.scenario.id && row.variant === run.variant.id),
        now,
      )
    ) {
      sections.push({
        title,
        skipped: `Passed within the last ${run.scenario.cadenceDays} days.`,
        checks: [],
        warnings: [],
        messages: [],
      });
      continue;
    }
    const tenantId =
      target === "live"
        ? liveTenant
        : target === "canary"
          ? undefined
          : localTenant(run.scenario, bookingTenant, reservationTenant, linkTenant);
    if (target === "local" && !tenantId) {
      const skipped =
        run.scenario.pool === "link"
          ? "SCENARIO_RESERVATION_LINK_TENANT_ID is not set, so this link scenario was skipped."
          : run.scenario.capability === "reservations"
            ? "SCENARIO_RESERVATION_TENANT_ID is not set, so this reservation scenario was skipped."
            : "No booking tenant. Set SCENARIO_BOOKING_TENANT_ID or DEV_TENANT_ID.";
      sections.push({ title, skipped, checks: [], warnings: [], messages: [] });
      recorded.push(resultRow(run, stamp(now).heading, "skip", skipped));
      continue;
    }
    if (blocked.has(run.scenario.capability)) {
      const skipped = "The server has no tenant for this capability.";
      sections.push({ title, skipped, checks: [], warnings: [], messages: [] });
      recorded.push(resultRow(run, stamp(now).heading, "skip", skipped));
      continue;
    }
    try {
      const played = await play({
        baseUrl,
        secret,
        target,
        tenantId,
        scenario: run.scenario,
        variantTurns: run.variant.turns,
        variantExpect: run.variant.expect,
        runId: crypto.randomUUID().slice(0, 8),
      });
      if (played.skip) {
        blocked.add(run.scenario.capability);
        sections.push({ title, skipped: played.skip, checks: [], warnings: [], messages: [] });
        recorded.push(resultRow(run, stamp(now).heading, "skip", played.skip));
        continue;
      }
      sections.push({
        title,
        leadId: played.snapshot?.leadId,
        personaGender: played.snapshot?.personaGender || undefined,
        review: reviewText([run.scenario.review, run.variant.review, run.scenario.followUp?.review, run.scenario.endThen?.review]),
        checks: played.checks,
        warnings: played.warnings,
        messages: played.snapshot?.messages ?? [],
      });
      const wrong = played.checks
        .filter((check) => !check.ok)
        .map((check) => `${check.name} — ${check.detail}`)
        .join("; ");
      recorded.push(resultRow(run, stamp(now).heading, wrong ? "fail" : "pass", wrong));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail === "missing_tenant" || detail === "missing_canary") {
        blocked.add(run.scenario.capability);
        sections.push({ title, skipped: detail, checks: [], warnings: [], messages: [] });
        recorded.push(resultRow(run, stamp(now).heading, "skip", detail));
        continue;
      }
      sections.push({
        title,
        checks: [{ name: "run", ok: false, detail }],
        warnings: [],
        messages: [],
      });
      recorded.push(resultRow(run, stamp(now).heading, "fail", detail));
    }
  }

  const when = stamp(new Date());
  const tenantNote =
    target === "canary"
      ? "canary tenants pinned on the server"
      : target === "live"
        ? `live ${liveTenant}`
        : `booking=${bookingTenant || "missing"}, reservations=${reservationTenant || "skipped"}, link=${linkTenant || "skipped"}`;
  const markdown = renderReview({
    when: when.heading,
    target,
    baseUrl,
    tenantNote,
    sections,
  });
  const dir = join(process.cwd(), "scenario-runs");
  mkdirSync(dir, { recursive: true });
  let filename = `test-conversations-${when.file}.md`;
  if (existsSync(join(dir, filename))) filename = `test-conversations-${when.file}-${pad(new Date().getSeconds())}.md`;
  const path = join(dir, filename);
  writeFileSync(path, markdown);
  const link = conversationLink(filename);
  for (const row of recorded) row.file = link;
  writeFileSync(resultsPath, mergeResults(previousResults, recorded));
  const failed = sections.some((section) => section.checks.some((check) => !check.ok));
  console.log(path);
  console.log(resultsPath);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
