import { describe, expect, it } from "vitest";
import { chat as en } from "@/lib/copy/en";
import { chat as he } from "@/lib/copy/he";
import { exceedsWhatsAppImage, inlineContentDisposition, isImageFile, isUploadableFile, presignedExpiry, presignedUrlStale, smartUploadName, supportedTypeLabels, uploadFileName, WHATSAPP_IMAGE_BYTES, ZERNIO_UPLOAD_BYTES } from "./file-types";

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

  it("names the WhatsApp image limit and the Zernio upload limit", () => {
    expect(WHATSAPP_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(ZERNIO_UPLOAD_BYTES).toBe(Math.round(4.5 * 1024 * 1024));
    expect(exceedsWhatsAppImage("image/jpeg", WHATSAPP_IMAGE_BYTES + 1)).toBe(true);
    expect(exceedsWhatsAppImage("image/png", WHATSAPP_IMAGE_BYTES)).toBe(false);
    expect(exceedsWhatsAppImage("application/pdf", WHATSAPP_IMAGE_BYTES + 1)).toBe(false);
  });

  it("reads an S3 signature and treats it as stale a minute before it dies", () => {
    const url = "https://files.example/id.pdf?X-Amz-Date=20261110T170351Z&X-Amz-Expires=900";
    expect(presignedExpiry(url)).toBe(Date.parse("2026-11-10T17:18:51Z"));
    expect(presignedUrlStale(url, new Date("2026-11-10T17:04:51Z"))).toBe(false);
    expect(presignedUrlStale(url, new Date("2026-11-10T17:21:59Z"))).toBe(true);
    expect(presignedUrlStale("https://files.example/plain.pdf")).toBe(false);
  });
});
