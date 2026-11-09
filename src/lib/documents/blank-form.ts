import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { appOrigin } from "@/lib/request-url";

/** Blank PDFs the agent sends. Kept out of docs/ so they are not mixed with notes. */
export const BLANK_FORMS_DIR = path.join(process.cwd(), "assets", "blank-forms");

function formSecret(): string {
  const hex = process.env.APP_ENCRYPTION_KEY ?? "";
  if (!hex) throw new Error("APP_ENCRYPTION_KEY is required to sign a blank form link");
  return hex;
}

/** Ties a public form link to one tenant without relying on the browser session. */
export function blankFormSignature(tenantId: string, type: string): string {
  return createHmac("sha256", formSecret()).update(`${tenantId}\n${type}`).digest("base64url");
}

export function blankFormSignatureMatches(tenantId: string, type: string, sig: string): boolean {
  try {
    const expected = Buffer.from(blankFormSignature(tenantId, type));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}

/** A link that opens the blank PDF. `file` is the name shown in the chat, not the path that is read. */
export function blankFormHref(tenantId: string, type: string, file: string): string {
  const params = new URLSearchParams({
    type,
    tenant: tenantId,
    sig: blankFormSignature(tenantId, type),
    file,
  });
  return `${appOrigin()}/api/documents/blank-form?${params}`;
}
