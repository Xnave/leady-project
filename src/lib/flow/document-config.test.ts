import { afterEach, describe, expect, it } from "vitest";
import { FlowConfigError } from "./types";
import { documentApiKey, documentConfigFromStored, isTestLead, parseDocumentConfig } from "./document-config";
import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";
import { SMART_NPV_HOST } from "@/lib/documents/smart-npv";

const KEY = "ab".repeat(32);

describe("parseDocumentConfig", () => {
  afterEach(() => {
    delete process.env.APP_ENCRYPTION_KEY;
  });

  it("uses the Smart NPV host and refuses any other", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    expect(parseDocumentConfig({ rules: MORTGAGE_RULES }).baseUrl).toBe(SMART_NPV_HOST);
    expect(parseDocumentConfig({ baseUrl: `${SMART_NPV_HOST}/api/v2`, rules: MORTGAGE_RULES }).baseUrl).toBe(
      SMART_NPV_HOST,
    );
    expect(() => parseDocumentConfig({ baseUrl: "https://smart.example", rules: MORTGAGE_RULES })).toThrow(
      FlowConfigError,
    );
    expect(() => parseDocumentConfig({ baseUrl: "fake://smart", rules: MORTGAGE_RULES })).toThrow(FlowConfigError);
    expect(() =>
      parseDocumentConfig({
        baseUrl: SMART_NPV_HOST,
        apiKey: "secret",
        rules: { stages: [], requirements: [], documents: {} },
      }),
    ).toThrow(FlowConfigError);
  });

  it("stores the key encrypted and keeps a blank resubmit", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const saved = parseDocumentConfig({
      baseUrl: SMART_NPV_HOST,
      apiKey: "secret",
      rules: MORTGAGE_RULES,
    });
    expect(saved.apiKeyEnc).not.toContain("secret");
    expect(documentApiKey(saved)).toBe("secret");
    const again = parseDocumentConfig(
      { baseUrl: SMART_NPV_HOST, apiKey: "", rules: MORTGAGE_RULES },
      saved.apiKeyEnc,
    );
    expect(documentApiKey(again)).toBe("secret");
    expect(again.testOnly).toBe(false);
  });

  it("allows a missing key and treats listed phones as test leads", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const saved = parseDocumentConfig({
      baseUrl: SMART_NPV_HOST,
      rules: MORTGAGE_RULES,
      testPhones: "0501234567\n0501234567",
    });
    expect(saved.apiKeyEnc).toBe("");
    expect(saved.testOnly).toBe(true);
    expect(saved.testPhones).toEqual(["0501234567"]);
    expect(saved.maxRejectTries).toBe(5);
    expect(saved.rejectCooldownMinutes).toBe(5);
    expect(isTestLead(saved, "+972501234567")).toBe(true);
    const keyed = parseDocumentConfig({
      baseUrl: SMART_NPV_HOST,
      apiKey: "secret",
      rules: MORTGAGE_RULES,
      testPhones: "0501234567",
    });
    expect(isTestLead(keyed, "0509999999")).toBe(false);
    expect(isTestLead(keyed, "0501234567")).toBe(true);
  });

  it("reads a saved config without dropping the encrypted key", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const saved = parseDocumentConfig({
      baseUrl: SMART_NPV_HOST,
      apiKey: "secret",
      rules: MORTGAGE_RULES,
      testPhones: ["0501234567"],
    });
    const loaded = documentConfigFromStored(saved);
    expect(loaded.testOnly).toBe(false);
    expect(documentApiKey(loaded)).toBe("secret");
    expect(loaded.testPhones).toEqual(["0501234567"]);
    expect(documentConfigFromStored({ rules: MORTGAGE_RULES }).testOnly).toBe(true);
  });

  it("keeps a stored key and phone list when the save omits both", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const again = parseDocumentConfig(
      { baseUrl: SMART_NPV_HOST, rules: MORTGAGE_RULES },
      "stored-key",
      ["0501234567"],
    );
    expect(again.apiKeyEnc).toBe("stored-key");
    expect(again.testPhones).toEqual(["0501234567"]);
    expect(again.testOnly).toBe(false);
  });

  it("keeps a saved unrecognized intro when the save omits it", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const again = parseDocumentConfig(
      { rules: MORTGAGE_RULES },
      "",
      [],
      "היי, אפשר לשאול אותי כאן.",
    );
    expect(again.unrecognizedIntro).toBe("היי, אפשר לשאול אותי כאן.");
  });

  it("keeps reject try and cool-off settings within range", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const saved = parseDocumentConfig({
      baseUrl: SMART_NPV_HOST,
      rules: MORTGAGE_RULES,
      maxRejectTries: "12",
      rejectCooldownMinutes: 0,
    });
    expect(saved.maxRejectTries).toBe(12);
    expect(saved.rejectCooldownMinutes).toBe(1);
  });
});
