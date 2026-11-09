import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BLANK_FORMS_DIR, blankFormFilePath, blankFormHref, blankFormSignatureMatches } from "./blank-form";

const KEY = "a".repeat(64);

describe("blank form links", () => {
  const previous = process.env.APP_ENCRYPTION_KEY;
  afterEach(() => {
    if (previous === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previous;
  });

  it("signs a link the form route can check without a session", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const href = blankFormHref("tenant-1", "accountant_letter", "אישור רואה חשבון עוסק מורשה.pdf");
    const url = new URL(href);
    expect(url.pathname).toBe("/api/documents/blank-form");
    expect(url.searchParams.get("file")).toBe("אישור רואה חשבון עוסק מורשה.pdf");
    expect(blankFormSignatureMatches(
      "tenant-1",
      "accountant_letter",
      url.searchParams.get("sig") ?? "",
    )).toBe(true);
    expect(blankFormSignatureMatches("other-tenant", "accountant_letter", url.searchParams.get("sig") ?? "")).toBe(false);
  });

  it("resolves only a single file inside the blank-forms folder", () => {
    expect(blankFormFilePath("letter.pdf")).toBe(path.resolve(BLANK_FORMS_DIR, "letter.pdf"));
    expect(blankFormFilePath("../.env")).toBeNull();
    expect(blankFormFilePath("nested/form.pdf")).toBeNull();
    expect(blankFormFilePath("..\\secret.pdf")).toBeNull();
  });
});
