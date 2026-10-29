import { describe, expect, it } from "vitest";
import { evaluateScenario, genderWarnings, predominantlyHebrew, replyChecks } from "./expect";
import {
  isScenarioSender,
  readScenarioEnv,
  scenarioAuthorized,
  scenarioSender,
  scenarioTenantIds,
} from "./guard";
import { renderReview } from "./review";
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
        requests: [{ id: "r", capabilityId: "booking", status: "approved" }],
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

  it("runs one id even when it is outside the suite", () => {
    const planned = planRuns([booking, full], { suite: "smoke", only: ["booking-handoff", "missing"] });
    expect(planned.unknownIds).toEqual(["missing"]);
    expect(planned.runs.map((run) => run.scenario.id)).toEqual(["booking-handoff"]);
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
