import { afterEach, describe, expect, it } from "vitest";
import { hitlNotice, formatHitlTaskLine, turnNeedsDemoNotice } from "./outbound";
import { activationPrefill, decorateRapidDemoText, demoExpiredText, demoInUseText, stripDemoFooter } from "./copy";
import {
  applyMissingName,
  chosenCapabilities,
  normalizeRapidExtract,
  profileNeedsName,
  markdownFromInteraction,
  RAPID_DEMO_RESEARCH_MODEL,
  researchPrompt,
  researchRequest,
} from "./extract";
import { isSharedDemoAccount, resolveRapidDemoAccountId, whatsappAccountMatches } from "./route-inbound";
import { lookupPinnedTo, parsePublicHttpsUrl, selectPublicAddress } from "./fetch-site";
import {
  decideDemoReuse,
  demoBindDecision,
  fileHost,
  hashIp,
  htmlToText,
  isBlockedHostname,
  isPublicIpAddress,
  parseDemoCode,
  parseDemoCommand,
  rapidDemoAuthorized,
  rateLimitDecision,
} from "./guards";

describe("rapid demo guards", () => {
  const prevSecret = process.env.RAPID_DEMO_API_SECRET;
  const prevHour = process.env.RAPID_DEMO_HOURLY_CAP;
  const prevDay = process.env.RAPID_DEMO_DAILY_CAP;

  afterEach(() => {
    process.env.RAPID_DEMO_API_SECRET = prevSecret;
    process.env.RAPID_DEMO_HOURLY_CAP = prevHour;
    process.env.RAPID_DEMO_DAILY_CAP = prevDay;
  });

  it("accepts only the shared bearer secret", () => {
    process.env.RAPID_DEMO_API_SECRET = "top-secret";
    expect(rapidDemoAuthorized("Bearer top-secret")).toBe(true);
    expect(rapidDemoAuthorized("Bearer nope")).toBe(false);
    expect(rapidDemoAuthorized(null)).toBe(false);
    delete process.env.RAPID_DEMO_API_SECRET;
    expect(rapidDemoAuthorized("Bearer top-secret")).toBe(false);
  });

  it("hashes an IP with the salt", () => {
    expect(hashIp("1.2.3.4", "salt")).toBe(hashIp("1.2.3.4", "salt"));
    expect(hashIp("1.2.3.4", "salt")).not.toBe(hashIp("1.2.3.4", "other"));
  });

  it("reuses the same host and blocks a second live demo", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const later = new Date("2026-10-16T12:00:00Z");
    const rows = [
      { websiteHost: "gold.example", status: "active", expiresAt: later, code: "ZD-AAAAAAAA" },
    ];
    expect(decideDemoReuse(rows, "gold.example", now)).toEqual({ type: "reuse", code: "ZD-AAAAAAAA" });
    expect(decideDemoReuse(rows, "other.example", now)).toEqual({ type: "conflict", code: "ZD-AAAAAAAA" });
    expect(
      decideDemoReuse(
        [{ websiteHost: "gold.example", status: "active", expiresAt: new Date("2026-10-15T11:00:00Z"), code: "ZD-AAAAAAAA" }],
        "other.example",
        now,
      ),
    ).toEqual({ type: "create" });
  });

  it("caps previews per visitor and globally", () => {
    process.env.RAPID_DEMO_HOURLY_CAP = "100";
    process.env.RAPID_DEMO_DAILY_CAP = "500";
    expect(rateLimitDecision({ visitorHour: 19, visitorDay: 19, globalHour: 0, globalDay: 0 })).toBe("ok");
    expect(rateLimitDecision({ visitorHour: 20, visitorDay: 0, globalHour: 0, globalDay: 0 })).toBe("rate_limited");
    expect(rateLimitDecision({ visitorHour: 0, visitorDay: 50, globalHour: 0, globalDay: 0 })).toBe("rate_limited");
    expect(rateLimitDecision({ visitorHour: 0, visitorDay: 0, globalHour: 100, globalDay: 0 })).toBe("hourly_cap");
    expect(rateLimitDecision({ visitorHour: 0, visitorDay: 0, globalHour: 0, globalDay: 500 })).toBe("daily_cap");
  });

  it("blocks private hosts and accepts public ones", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("secret.internal")).toBe(true);
    expect(isBlockedHostname("127.0.0.1")).toBe(true);
    expect(isBlockedHostname("gold.example")).toBe(false);
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("10.1.1.1")).toBe(false);
    expect(isPublicIpAddress("192.168.0.5")).toBe(false);
    expect(isPublicIpAddress("172.16.0.1")).toBe(false);
    expect(isPublicIpAddress("169.254.1.1")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("fe80::1")).toBe(false);
    expect(isPublicIpAddress("fe90::1")).toBe(false);
    expect(isPublicIpAddress("fec0::1")).toBe(false);
    expect(isPublicIpAddress("fed0::1")).toBe(false);
    expect(isPublicIpAddress("64:ff9b::808:808")).toBe(false);
    expect(isPublicIpAddress("64:ff9b::192.0.2.1")).toBe(false);
    expect(isPublicIpAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
    expect(selectPublicAddress(["8.8.8.8", "1.1.1.1"])).toBe("8.8.8.8");
    expect(selectPublicAddress(["8.8.8.8", "127.0.0.1"])).toBeNull();
    expect(selectPublicAddress([])).toBeNull();
    expect(parsePublicHttpsUrl("http://gold.example")).toBeNull();
    expect(parsePublicHttpsUrl("https://127.0.0.1/admin")).toBeNull();
    expect(parsePublicHttpsUrl("https://gold.example/about")?.hostname).toBe("gold.example");
  });

  it("reads a demo code and exact commands", () => {
    expect(parseDemoCode("היי Zapidly, תפתחו לי את הדמו ZD-K7M2Q9PX")).toBe("ZD-K7M2Q9PX");
    expect(parseDemoCode(activationPrefill({ code: "ZD-K7M2Q9PX", name: "מטבחי זהב", lang: "he" }))).toBe(
      "ZD-K7M2Q9PX",
    );
    expect(parseDemoCode(activationPrefill({ code: "ZD-K7M2Q9PX", name: "Gold Kitchens", lang: "en" }))).toBe(
      "ZD-K7M2Q9PX",
    );
    expect(parseDemoCode("hello")).toBeNull();
    expect(parseDemoCommand("restart")).toBe("restart");
    expect(parseDemoCommand("new")).toBe("restart");
    expect(parseDemoCommand("״חדש״")).toBe("restart");
    expect(parseDemoCommand("Tasks")).toBe("tasks");
    expect(parseDemoCommand("משימות")).toBe("tasks");
    expect(parseDemoCommand("please restart")).toBeNull();
    expect(parseDemoCommand("היי Zapidly ZD-K7M2Q9PX")).toBeNull();
  });

  it("binds a demo only to the first phone", () => {
    expect(demoBindDecision(null, "972501111111")).toBe("bind");
    expect(demoBindDecision("972501111111", "972501111111")).toBe("continue");
    expect(demoBindDecision("972501111111", "972502222222")).toBe("in_use");
    expect(demoInUseText("en")).toContain("already in use");
    expect(demoExpiredText("en")).toContain("zapidly.com");
    expect(demoExpiredText("he")).toContain("zapidly.com");
  });

  it("builds a warm activation prefill with the business name", () => {
    expect(activationPrefill({ code: "ZD-AAAAAAAA", name: "מטבחי זהב", lang: "he" })).toContain("מטבחי זהב");
    expect(activationPrefill({ code: "ZD-AAAAAAAA", name: "מטבחי זהב", lang: "he" })).toContain("ZD-AAAAAAAA");
    expect(activationPrefill({ code: "ZD-AAAAAAAA", name: "Gold Kitchens", lang: "en" })).toContain(
      "Gold Kitchens",
    );
  });

  it("strips html and keys a file upload", () => {
    expect(htmlToText("<style>x</style><p>Hello <b>there</b></p>")).toBe("Hello there");
    expect(fileHost(" same ")).toBe(fileHost("same"));
    expect(fileHost("same")).not.toBe(fileHost("other"));
  });
});

describe("rapid demo extract", () => {
  it("asks only when the name is missing and keeps the visitor's capabilities", () => {
    const missing = normalizeRapidExtract({ capabilities: ["booking", "nope"] }, "We cut hair.");
    expect(profileNeedsName(missing)).toBe(true);
    expect(missing.capabilities).toEqual(["booking"]);
    expect(chosenCapabilities(["reservations", "booking", "faq"])).toEqual(["reservations", "booking"]);
    const named = applyMissingName(missing, "Gold Clinic");
    expect(named.name).toBe("Gold Clinic");
    expect(named.intro).toContain("Gold Clinic");
    expect(named.capabilities).toEqual(["booking"]);
    expect(profileNeedsName(named)).toBe(false);
  });

  it("keeps a model name and does not invent one", () => {
    const profile = normalizeRapidExtract({ name: "  Noga  ", capabilities: [] }, "hello");
    expect(profile.name).toBe("Noga");
    expect(profile.capabilities).toEqual([]);
    expect(profileNeedsName(profile)).toBe(false);
  });

  it("builds the Gemini research prompt from the business name and site", () => {
    const prompt = researchPrompt("נוגה", "https://noga.example", "שעות פתיחה 9 עד 18");
    expect(prompt).toContain("צור לי קובץ md לסוכן ai");
    expect(prompt).toContain("נוגה");
    expect(prompt).toContain("https://noga.example");
    expect(prompt).toContain("שעות פתיחה 9 עד 18");
    const request = researchRequest("נוגה", "https://noga.example/", prompt);
    expect(request.model).toBe(RAPID_DEMO_RESEARCH_MODEL);
    expect(request.tools).toEqual([{ type: "url_context" }]);
    expect(request.model).toBe("gemini-3.8-flash");
  });

  it("reads the knowledge markdown from an Interactions response", () => {
    expect(markdownFromInteraction({ output_text: "```md\n# Noga\n\nHours: 9-18\n```" })).toBe("# Noga\n\nHours: 9-18");
    expect(
      markdownFromInteraction({
        steps: [{ type: "model_output", content: [{ type: "text", text: "# Clinic" }] }],
      }),
    ).toBe("# Clinic");
    expect(markdownFromInteraction({ steps: [{ type: "url_context_result" }] })).toBeUndefined();
  });
});

describe("rapid demo hot path", () => {
  it("ignores numbers that are not the shared WhatsApp account", () => {
    expect(isSharedDemoAccount("other-account", "zapidly-account")).toBe(false);
    expect(isSharedDemoAccount("zapidly-account", "zapidly-account")).toBe(true);
    expect(isSharedDemoAccount("zapidly-account", null)).toBe(false);
  });

  it("uses a pinned WhatsApp account id and refuses short digit suffixes", async () => {
    const prev = process.env.RAPID_DEMO_WHATSAPP_ACCOUNT_ID;
    process.env.RAPID_DEMO_WHATSAPP_ACCOUNT_ID = " acct-1 ";
    await expect(resolveRapidDemoAccountId()).resolves.toBe("acct-1");
    if (prev === undefined) delete process.env.RAPID_DEMO_WHATSAPP_ACCOUNT_ID;
    else process.env.RAPID_DEMO_WHATSAPP_ACCOUNT_ID = prev;

    expect(whatsappAccountMatches("972555076806", "972555076806")).toBe(true);
    expect(whatsappAccountMatches("555076806", "972555076806")).toBe(true);
    expect(whatsappAccountMatches("6", "972555076806")).toBe(false);
    expect(whatsappAccountMatches("06", "06")).toBe(false);
    expect(whatsappAccountMatches("972555076806", "6806")).toBe(false);
    expect(whatsappAccountMatches("972555076807", "972555076806")).toBe(false);
  });

  it("pins the connection lookup to the address that was already checked", () => {
    const lookup = lookupPinnedTo("8.8.8.8");
    lookup("rebind.example", {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe("8.8.8.8");
      expect(family).toBe(4);
    });
    lookup("rebind.example", { all: true }, (err, addresses) => {
      expect(err).toBeNull();
      expect(addresses).toEqual([{ address: "8.8.8.8", family: 4 }]);
    });
  });

  it("skips the HITL notice unless the lead is a rapid demo", () => {
    expect(turnNeedsDemoNotice({ rapidDemo: true })).toBe(true);
    expect(turnNeedsDemoNotice({})).toBe(false);
    expect(turnNeedsDemoNotice(undefined)).toBe(false);
  });
});

describe("rapid demo outbound", () => {
  it("appends the demo menu once", () => {
    const once = decorateRapidDemoText("See you Thursday.", "en");
    expect(once).toContain('This is a demo created by Zapidly.com. Type "new" to start over or "tasks" to show open tasks.');
    expect(decorateRapidDemoText("נתראה.", "he")).toContain(
      "זו הדגמה שנוצרה על ידי Zapidly.com . הקלד ״חדש״ להתחלה מחדש או ״משימות״ להצגת המשימות.",
    );
    expect(decorateRapidDemoText(once, "en")).toBe(once.trim());
    expect(stripDemoFooter(`${once}`)).toBe("See you Thursday.");
  });

  it("describes a HITL task that production created", () => {
    const line = formatHitlTaskLine({
      type: "request_approval",
      reason: "request_approval",
      payload: { kind: "visit", timeText: "Thu 17:00", name: "Dana" },
    });
    const notice = hitlNotice("en", [
      { type: "request_approval", reason: "request_approval", payload: { kind: "visit", timeText: "Thu 17:00", name: "Dana" } },
    ]);
    expect(line).toContain("visit");
    expect(formatHitlTaskLine({
      type: "request_approval",
      reason: "request_approval",
      payload: { kind: "visit", timeText: "22 באוקטובר בשעה 15:00", name: "נווה" },
    }, "he")).toBe("פגישה · 22 באוקטובר בשעה 15:00 · נווה");
    expect(line).toContain("Thu 17:00");
    expect(notice).toContain(line);
    expect(notice).toContain("Zapidly");
    expect(notice).toContain("pauses");
  });
});
