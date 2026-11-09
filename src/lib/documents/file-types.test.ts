import { describe, expect, it } from "vitest";
import { chat as en } from "@/lib/copy/en";
import { chat as he } from "@/lib/copy/he";
import { inlineContentDisposition, isImageFile, isUploadableFile, smartUploadName, supportedTypeLabels, uploadFileName } from "./file-types";

describe("supported document types", () => {
  it("allows pdf, png, jpg, and jpeg only", () => {
    expect(isUploadableFile("application/pdf", "id.pdf")).toBe(true);
    expect(isUploadableFile("image/jpeg", "scan.jpg")).toBe(true);
    expect(isUploadableFile("image/jpg", "scan.jpeg")).toBe(true);
    expect(isUploadableFile("image/png", "scan.png")).toBe(true);
    expect(isUploadableFile("image/heic", "scan.heic")).toBe(false);
    expect(isUploadableFile("application/zip", "docs.zip")).toBe(false);
  });

  it("names the uploaded file with an allowed extension", () => {
    expect(uploadFileName("id card.pdf", "application/pdf")).toBe("id card.pdf");
    expect(uploadFileName("scan", "image/png")).toBe("scan.png");
  });

  it("keeps a Hebrew filename out of the Latin-1 download header", () => {
    const header = inlineContentDisposition("לווה_תעודת_זהות_2026-11-09_01.pdf");
    expect([...header].every((char) => char.charCodeAt(0) <= 255)).toBe(true);
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("לווה_תעודת_זהות_2026-11-09_01.pdf"));
  });

  it("names a Smart NPV upload from the borrower, the Hebrew label, the day, and a version", () => {
    expect(
      smartUploadName({
        borrowerName: "חיים כהן",
        docLabel: "תעודת זהות",
        date: "2026-11-02",
        version: 1,
      }),
    ).toBe("חיים_כהן_תעודת_זהות_2026-11-02_01.pdf");
    expect(isImageFile("image/jpeg", "page.jpg")).toBe(true);
    expect(isImageFile("application/pdf", "id.pdf")).toBe(false);
  });

  it("is the list the customer is told", () => {
    const labels = supportedTypeLabels("or");
    expect(labels).toBe("PDF, PNG, JPG, or JPEG");
    expect(en.documents.reasons.unsupported_type).toContain(labels);
    expect(he.documents.reasons.unsupported_type).toContain(supportedTypeLabels("או"));
  });
});
