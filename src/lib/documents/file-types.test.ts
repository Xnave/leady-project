import { describe, expect, it } from "vitest";
import { chat as en } from "@/lib/copy/en";
import { chat as he } from "@/lib/copy/he";
import { isUploadableFile, supportedTypeLabels, uploadFileName } from "./file-types";

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

  it("is the list the customer is told", () => {
    const labels = supportedTypeLabels("or");
    expect(labels).toBe("PDF, PNG, JPG, or JPEG");
    expect(en.documents.reasons.unsupported_type).toContain(labels);
    expect(he.documents.reasons.unsupported_type).toContain(supportedTypeLabels("או"));
  });
});
