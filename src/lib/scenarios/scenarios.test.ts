import { describe, expect, it } from "vitest";
import { evaluateScenario, genderWarnings, predominantlyHebrew, replyChecks } from "./expect";
import {
  isScenarioSender,
  parseScenarioBefore,
  readScenarioEnv,
  scenarioAuthorized,
  scenarioLeadPurgeWhere,
  scenarioSender,
  scenarioTenantIds,
} from "./guard";
import { renderReview } from "./review";
import { mergeResults, parseResults, scenarioDue } from "./results";
import { planRuns } from "./select";
import type { Scenario, ScenarioSnapshot } from "./types";

const secret = "scenario-test-secret";

function env(partial: Record<string, string | undefined>, production: boolean) {
  return readScenarioEnv({ SCENARIO_RUNNER_SECRET: secret, ...partial }, production);
}

function snapshot(partial: Partial<ScenarioSnapshot> = {}): ScenarioSnapshot {
  return {
    tenantId: "t",
    tenantName: "דמו",
    personaGender: "female",
    chatLanguage: "he",
    leadId: "lead",
    externalUserId: "demo-scenario-x-1",
    conversationId: "c1",
    status: "open",
    flowState: "talk",
    lifecycleReason: "inbound_create",
    crm: {},
    session: {},
    messages: [
      { conversationId: "c1", role: "lead", text: "היי" },
      { conversationId: "c1", role: "agent", text: "שלום, איך אפשר לעזור?" },
    ],
    requests: [],
    hitl: [],
    ...partial,
  };
}

const booking: Scenario = {
  id: "booking-happy",
  suite: "smoke",
  capability: "booking",
  review: "בדקי מגדר",
  expect: { request: "pending" },
  variants: [
    { id: "tomorrow", primary: true, turns: ["מחר ב-10"] },
    { id: "tuesday", sample: true, turns: ["יום שלישי"] },
  ],
};

describe("scenario guard", () => {
  it("rejects a missing or mismatched secret", () => {
    expect(scenarioAuthorized(null, secret)).toBe(false);
    expect(scenarioAuthorized("Bearer wrong-secret!!", secret)).toBe(false);
    expect(scenarioAuthorized("Bearer short", secret)).toBe(false);
    expect(scenarioAuthorized(`Bearer ${secret}`, "")).toBe(false);
    expect(scenarioAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("forces a demo-scenario sender", () => {
    expect(scenarioSender("Booking Happy", "ABC")).toBe("demo-scenario-bookinghappy-abc");
    expect(isScenarioSender("demo-scenario-booking-abc")).toBe(true);
    expect(isScenarioSender("demo-chat")).toBe(false);
  });

  it("refuses every tenant in production when nothing is pinned", () => {
    const resolved = scenarioTenantIds(env({}, true), { target: "canary", capability: "booking" });
    expect(resolved).toEqual({ ok: false, status: 503, error: "empty_allowlist" });
  });

  it("allows the pinned link reservation tenant", () => {
    const pinned = env(
      { SCENARIO_RESERVATION_TENANT_ID: "hold", SCENARIO_RESERVATION_LINK_TENANT_ID: "link-tenant" },
      false,
    );
    expect(
      scenarioTenantIds(pinned, { target: "local", capability: "reservations", tenantId: "link-tenant" }),
    ).toEqual({ ok: true, tenantIds: ["link-tenant"] });
    expect(
      scenarioTenantIds(pinned, { target: "local", capability: "reservations", tenantId: "other" }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("allows a live tenant only from the allowlist", () => {
    const pinned = env({ SCENARIO_TENANT_ALLOWLIST: "live-1", SCENARIO_CANARY_BOOKING_TENANT_ID: "canary-b" }, true);
    expect(scenarioTenantIds(pinned, { target: "live", tenantId: "other" })).toMatchObject({ ok: false, status: 403 });
    expect(scenarioTenantIds(pinned, { target: "live", tenantId: "live-1" })).toEqual({
      ok: true,
      tenantIds: ["live-1"],
    });
    expect(scenarioTenantIds(pinned, { target: "canary", capability: "booking", tenantId: "live-1" })).toEqual({
      ok: true,
      tenantIds: ["canary-b"],
    });
  });

  it("uses the dev tenant locally and skips a reservation tenant that is not set", () => {
    const local = env({ DEV_TENANT_ID: "dev-1" }, false);
    expect(scenarioTenantIds(local, { target: "local", capability: "booking" })).toEqual({
      ok: true,
      tenantIds: ["dev-1"],
    });
    expect(scenarioTenantIds(local, { target: "local", capability: "reservations" })).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(scenarioTenantIds(local, { target: "local", tenantId: "someone-else" })).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe("scenario checks", () => {
  it("treats a Hebrew reply as Hebrew and an English reply as not", () => {
    expect(predominantlyHebrew("שלום, נקבע לך ביקור")).toBe(true);
    expect(predominantlyHebrew("Sure, booked")).toBe(false);
    const linked = evaluateScenario(
      snapshot({
        messages: [
          { conversationId: "c1", role: "lead", text: "הוילה הראשית" },
          { conversationId: "c1", role: "agent", text: "אפשר להשלים את הבקשה כאן: https://app.example/book" },
        ],
      }),
      { replyIncludes: ["http"], request: "none" },
      { phase: "after turns", capability: "reservations" },
    );
    expect(linked.every((check) => check.ok)).toBe(true);
    const friday = evaluateScenario(
      snapshot({
        requests: [{ id: "r", capabilityId: "reservations", status: "pending", timeText: "2026-10-30 → 2026-11-01" }],
      }),
      { requestStartsOn: "friday" },
      { phase: "after turns", capability: "reservations" },
    );
    expect(friday[0]?.ok).toBe(true);
    const thursday = evaluateScenario(
      snapshot({
        requests: [{ id: "r", capabilityId: "reservations", status: "pending", timeText: "2026-10-29 → 2026-11-01" }],
      }),
      { requestStartsOn: "friday" },
      { phase: "after turns", capability: "reservations" },
    );
    expect(thursday[0]?.ok).toBe(false);
    expect(
      predominantlyHebrew(
        "אפשר להשלים את הבקשה עבור אירוח כאן: https://app.b-on.co.il/online/order-v2/plaza-boutique?dateFrom=2026-10-29&dateTo=2026-11-01",
      ),
    ).toBe(true);
  });

  it("warns when the agent speaks about itself in the other gender", () => {
    expect(genderWarnings("אני יכולה לבדוק", "female")).toEqual([]);
    expect(genderWarnings("אני יכול לבדוק", "female")[0]).toMatch(/אני יכול/);
    expect(genderWarnings("אני שמחה", "male")[0]).toMatch(/אני שמחה/);
    expect(genderWarnings("אני יכולה", "")).toEqual([]);
  });

  it("fails a request that should not exist and a session key that survived", () => {
    const checks = evaluateScenario(
      snapshot({
        requests: [{ id: "r", capabilityId: "booking", status: "approved", timeText: "" }],
        session: { time_preference: "מחר" },
        crm: { name: "דנה" },
      }),
      { request: "none", sessionAbsent: ["time_preference"], crmPresent: ["name", "phone"] },
      { phase: "after turns", capability: "booking" },
    );
    expect(checks.find((check) => check.name.includes("request none"))?.ok).toBe(false);
    expect(checks.find((check) => check.name.includes("time_preference"))?.ok).toBe(false);
    expect(checks.find((check) => check.name.includes("crm name"))?.ok).toBe(true);
    expect(checks.find((check) => check.name.includes("crm phone"))?.ok).toBe(false);
  });

  it("fails a hours question that ignores a time already given", () => {
    const checks = evaluateScenario(
      snapshot({
        messages: [
          { conversationId: "c1", role: "lead", text: "סליחה, התכוונתי למחר ב-10" },
          {
            conversationId: "c1",
            role: "agent",
            text: "אפשר להיפגש בשעות הבאות. איזה יום ושעה יתאימו לך?",
          },
        ],
      }),
      { sessionPresent: ["time_preference"], replyAvoids: ["איזה יום ושעה"] },
      { phase: "after turns", capability: "booking" },
    );
    expect(checks.find((check) => check.name.includes("captured time_preference"))?.ok).toBe(false);
    expect(checks.find((check) => check.name.includes("does not re-ask"))?.ok).toBe(false);
  });

  it("fails two identical agent replies", () => {
    const checks = replyChecks(
      snapshot({
        messages: [
          { conversationId: "c1", role: "agent", text: "מה השם?" },
          { conversationId: "c1", role: "agent", text: "מה השם?" },
        ],
      }),
    );
    expect(checks.find((check) => check.name === "no repeated reply")?.ok).toBe(false);
  });

  it("does not treat the same greeting in two threads as a repeated reply", () => {
    const checks = replyChecks(
      snapshot({
        messages: [
          { conversationId: "c1", role: "agent", text: "שלום" },
          { conversationId: "c2", role: "agent", text: "שלום" },
        ],
      }),
    );
    expect(checks.find((check) => check.name === "no repeated reply")?.ok).toBe(true);
  });
});

describe("scenario selection", () => {
  const full: Scenario = {
    ...booking,
    id: "booking-handoff",
    suite: "full",
    variants: [{ id: "primary", primary: true, turns: ["בן אדם"] }],
  };

  it("runs smoke primaries, and samples only marked variants", () => {
    const planned = planRuns([booking, full], { suite: "smoke", sample: 1, rng: () => 0 });
    expect(planned.unknownIds).toEqual([]);
    expect(planned.runs.map((run) => `${run.scenario.id}:${run.variant.id}`)).toEqual([
      "booking-happy:tomorrow",
      "booking-happy:tuesday",
    ]);
  });

  it("keeps the link suite out of smoke and full", () => {
    const link: Scenario = {
      ...booking,
      id: "reservation-link-stay",
      suite: "link",
      capability: "reservations",
      pool: "link",
      cadenceDays: 7,
      variants: [{ id: "thu-sun", primary: true, turns: ["היי"] }],
    };
    expect(planRuns([booking, link], { suite: "smoke" }).runs.map((run) => run.scenario.id)).toEqual([
      "booking-happy",
    ]);
    expect(planRuns([booking, link], { suite: "full" }).runs.map((run) => run.scenario.id)).toEqual([
      "booking-happy",
    ]);
    expect(planRuns([booking, link], { suite: "link" }).runs.map((run) => run.scenario.id)).toEqual([
      "reservation-link-stay",
    ]);
    const extra: Scenario = { ...booking, id: "reservation-offer-accept", suite: "extra" };
    expect(planRuns([booking, extra], { suite: "smoke" }).runs.map((run) => run.scenario.id)).toEqual([
      "booking-happy",
    ]);
    expect(planRuns([booking, extra], { suite: "extra" }).runs.map((run) => run.scenario.id)).toEqual([
      "reservation-offer-accept",
    ]);
  });

  it("runs one id even when it is outside the suite", () => {
    const planned = planRuns([booking, full], { suite: "smoke", only: ["booking-handoff", "missing"] });
    expect(planned.unknownIds).toEqual(["missing"]);
    expect(planned.runs.map((run) => run.scenario.id)).toEqual(["booking-handoff"]);
  });
});

describe("scenario results", () => {
  it("keeps an older row and replaces the one that just ran", () => {
    const first = mergeResults("", [
      {
        scenario: "reservation-link-stay",
        variant: "thu-sun",
        cadence: "7d",
        lastRun: "2026-10-29 18:13",
        result: "pass",
        wrong: "",
      },
      {
        scenario: "booking-happy",
        variant: "tomorrow",
        cadence: "",
        lastRun: "2026-10-29 16:48",
        result: "pass",
        wrong: "",
      },
    ]);
    const second = mergeResults(first, [
      {
        scenario: "reservation-link-stay",
        variant: "thu-sun",
        cadence: "7d",
        lastRun: "2026-10-30 09:00",
        result: "fail",
        wrong: "after turns: request pending — none",
      },
    ]);
    const rows = parseResults(second);
    expect(rows.map((row) => `${row.scenario}:${row.result}`)).toEqual([
      "booking-happy:pass",
      "reservation-link-stay:fail",
    ]);
    expect(rows[1]?.wrong).toMatch(/request pending/);
    expect(second).toMatch(/\| Conversation \|/);
  });

  it("treats a recent pass as not due and a failure as due", () => {
    const passed = {
      scenario: "reservation-link-stay",
      variant: "thu-sun",
      cadence: "7d",
      lastRun: "2026-10-29 18:13",
      result: "pass" as const,
      wrong: "",
    };
    expect(scenarioDue(7, passed, new Date(2026, 9, 30, 18, 13))).toBe(false);
    expect(scenarioDue(7, passed, new Date(2026, 10, 6, 18, 13))).toBe(true);
    expect(scenarioDue(7, { ...passed, result: "fail" }, new Date(2026, 9, 30, 18, 13))).toBe(true);
    expect(scenarioDue(undefined, undefined, new Date())).toBe(true);
  });
});

describe("scenario purge", () => {
  it("deletes only scenario senders, and only those created before the given local day", () => {
    expect(parseScenarioBefore("2026-11-01")?.getTime()).toBe(new Date(2026, 10, 1).getTime());
    expect(parseScenarioBefore("2026-02-31")).toBeNull();
    expect(parseScenarioBefore("yesterday")).toBeNull();
    const day = parseScenarioBefore("2026-11-01")!;
    expect(scenarioLeadPurgeWhere(["t1"], day)).toEqual({
      tenantId: { in: ["t1"] },
      externalUserId: { startsWith: "demo-scenario-" },
      createdAt: { lt: day },
    });
    expect(scenarioLeadPurgeWhere(["t1"])).not.toHaveProperty("createdAt");
  });
});

describe("review file", () => {
  it("puts failed checks in the summary and the conversation underneath", () => {
    const text = renderReview({
      when: "2026-10-28 17:42",
      target: "local",
      baseUrl: "http://localhost:3000",
      tenantNote: "booking=dev-1",
      sections: [
        {
          title: "booking-happy · tomorrow",
          leadId: "lead-1",
          personaGender: "female",
          review: "בדקי שהפנייה נקבית",
          checks: [{ name: "after turns: request pending", ok: false, detail: "none" }],
          warnings: [],
          messages: [
            { conversationId: "c1", role: "lead", text: "היי" },
            { conversationId: "c1", role: "agent", text: "שלום" },
          ],
        },
      ],
    });
    expect(text).toContain("# Test conversations 2026-10-28 17:42");
    expect(text).toContain("Hard checks: 0 passed, 1 failed");
    expect(text).toContain("- [ ] booking-happy · tomorrow");
    expect(text).toContain("**Lead:** היי");
    expect(text).toContain("**Agent:** שלום");
    expect(text).toContain("--purge-lead lead-1");
  });
});
