import { borrowersOf, factsFromClient } from "./facts";
import { isUploadableFile, uploadFileName } from "./file-types";
import type { Profile } from "./rules";

export { isUploadableFile, uploadFileName };

/** Smart NPV stores a PDF. Customer images are merged before they reach this call. */
function isPdfUpload(mime: string, filename: string): boolean {
  return mime.toLowerCase() === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

export type SmartClientHit = { clientId: string; profile: Profile };

export type SmartListQuery = {
  limit?: number;
  offset?: number;
  /** 1 = created, 2 = modified. Dates are DD/MM/YYYY, matching the published list filters. */
  rangeType?: 1 | 2;
  from?: string;
  until?: string;
};

/**
 * The only module that speaks HTTP to SmartNPV.
 * Official docs: https://api.snpv.co.il/
 *   GET  {root}/clients/get?api_key&type=phone|id_number
 *   GET  {root}/clients/list?api_key
 *   POST {root}/clients/upload_document  (form: api_key, uuid, file_name, file)
 * The host is www.snpv.co.il. api.snpv.co.il is the docs site.
 * Upload accepts PDF, PNG, JPG, JPEG and returns no file id, so a successful
 * call is recorded under the file_name we sent. There is no delete.
 */
export type SmartClient = {
  findClient(query: { phone?: string; nationalId?: string }): Promise<SmartClientHit | null>;
  listClients(query?: SmartListQuery): Promise<SmartClientHit[]>;
  upload(opts: {
    clientId: string;
    docType: string;
    filename: string;
    mime: string;
    bytes: Buffer;
  }): Promise<{ remoteId: string }>;
  /** Files already stored for this client on the upload day. Missing means the caller skips the link. */
  listUploads?(clientId: string, day: string): Promise<{ fileName: string; downloadUrl: string }[]>;
};

export const FAKE_SMART_PROFILE: Profile = {
  employment: "employed",
  hasLoans: true,
  nationalId: "123456782",
  fullName: "Dana Levi",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Israeli mobiles arrive as +972… from WhatsApp. clients/get examples use 05… */
export function toSmartPhone(raw: string): string {
  const compact = raw.replace(/[^\d+]/g, "");
  if (compact.startsWith("+972")) return `0${compact.slice(4)}`;
  if (compact.startsWith("972")) return `0${compact.slice(3)}`;
  return digits(raw);
}

/** A slot that already has a remote id must not be sent again. */
export function slotNeedsUpload(slot: {
  status: string;
  remoteId?: string;
  months?: string[];
  coveredMonths?: string[];
} | undefined): boolean {
  if (!slot) return false;
  if (slot.months?.length) {
    const covered = new Set(slot.coveredMonths ?? []);
    return slot.months.some((month) => !covered.has(month));
  }
  if (slot.status === "uploaded" || slot.remoteId) return false;
  return true;
}

/**
 * Map a clients/get record onto checklist facts.
 * `status_report_1` / `status_report_2` choose employment. An empty code stays unknown.
 * Empty `liabilities` stays unknown loans, not "no loans".
 */
export function mapSmartProfile(raw: Record<string, unknown>, preferId = ""): Profile {
  const profile = factsFromClient(raw);
  const wanted = digits(preferId);
  const chosen = borrowersOf(profile).find((borrower) => wanted && digits(borrower.nationalId) === wanted);
  if (!chosen) return profile;
  return {
    ...profile,
    nationalId: chosen.nationalId,
    fullName: chosen.fullName,
    phone: chosen.phone,
    employment: chosen.employment === "unknown" ? "" : chosen.employment,
    employmentCode: chosen.statusReport,
    employmentLabel: chosen.employmentLabel,
  };
}

function hitFromClient(raw: Record<string, unknown>, preferId = ""): SmartClientHit | null {
  const clientId = text(raw.uuid) || text(raw.clientId);
  if (!clientId) return null;
  return { clientId, profile: mapSmartProfile(raw, preferId) };
}

export function createFakeSmartClient(profile: Profile = FAKE_SMART_PROFILE): SmartClient {
  const hit = (phone?: string): SmartClientHit => ({
    clientId: "fake-client",
    profile: { ...profile, phone: phone || profile.phone },
  });
  return {
    async findClient(query) {
      if (!query.phone && !query.nationalId) return null;
      return hit(query.phone);
    },
    async listClients() {
      return [hit()];
    },
    async upload(opts) {
      if (!isUploadableFile(opts.mime, opts.filename) || !isPdfUpload(opts.mime, opts.filename)) {
        throw new Error("unsupported_type");
      }
      return { remoteId: `fake-${uploadFileName(opts.filename, opts.mime)}` };
    },
  };
}

type Envelope = {
  response?: boolean;
  responseCode?: number;
  responseMessage?: string;
  message?: string;
  uuid?: string;
  remoteId?: string;
  responseClientFields?: Record<string, unknown> | null;
  responseClients?: Record<string, unknown>[];
  responseDocuments?: unknown;
};

function apiRoot(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return /\/api\/v2$/i.test(base) ? base : `${base}/api/v2`;
}

async function readEnvelope(res: Response): Promise<Envelope> {
  const body = (await res.json()) as Envelope;
  return body && typeof body === "object" ? body : {};
}

export function createHttpSmartClient(opts: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }): SmartClient {
  const root = apiRoot(opts.baseUrl);
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function get(path: string, params: Record<string, string>): Promise<Envelope> {
    const query = new URLSearchParams({ api_key: opts.apiKey, ...params });
    const res = await fetchImpl(`${root}${path}?${query}`);
    if (!res.ok) throw new Error(`smart ${path} ${res.status}`);
    return readEnvelope(res);
  }

  return {
    async findClient(query) {
      const params: Record<string, string> = {};
      if (query.phone) {
        const phone = toSmartPhone(query.phone);
        if (!phone) return null;
        params.type = "phone";
        params.phone = phone;
      } else if (query.nationalId) {
        const idNumber = digits(query.nationalId);
        if (!idNumber) return null;
        params.type = "id_number";
        params.id_number = idNumber;
      } else {
        return null;
      }
      const body = await get("/clients/get", params);
      if (body.response === false) return null;
      const fields = body.responseClientFields;
      if (!fields || typeof fields !== "object") return null;
      return hitFromClient(fields, query.nationalId ?? "");
    },
    async listClients(query = {}) {
      const params: Record<string, string> = {};
      if (query.limit != null) params.limit = String(query.limit);
      if (query.offset != null) params.offset = String(query.offset);
      if (query.rangeType != null) params.range_type = String(query.rangeType);
      if (query.from) params.from = query.from;
      if (query.until) params.until = query.until;
      const body = await get("/clients/list", params);
      if (body.response === false) throw new Error(body.responseMessage || "smart list failed");
      return (body.responseClients ?? [])
        .map((row) => hitFromClient(row))
        .filter((hit): hit is SmartClientHit => hit !== null);
    },
    async upload(input) {
      if (!isUploadableFile(input.mime, input.filename) || !isPdfUpload(input.mime, input.filename)) {
        throw new Error("unsupported_type");
      }
      const fileName = uploadFileName(input.filename, input.mime);
      const form = new FormData();
      form.append("api_key", opts.apiKey);
      form.append("uuid", input.clientId);
      form.append("file_name", fileName);
      form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.mime || "application/octet-stream" }), fileName);
      const res = await fetchImpl(`${root}/clients/upload_document`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`smart upload ${res.status}`);
      const body = await readEnvelope(res);
      if (body.response === false || (body.responseCode != null && body.responseCode !== 0)) {
        throw new Error(body.message || body.responseMessage || "smart upload rejected");
      }
      return { remoteId: text(body.uuid) || text(body.remoteId) || fileName };
    },
    async listUploads(clientId, day) {
      const [year, month, date] = day.split("-");
      const dmy = year && month && date ? `${date}/${month}/${year}` : day;
      const body = await get("/clients/get_uploaded_documents", { uuid: clientId, from: dmy, until: dmy });
      if (body.response === false) return [];
      const rows = Array.isArray(body.responseDocuments) ? body.responseDocuments : [];
      return rows.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const record = row as Record<string, unknown>;
        const fileName = text(record.file_name) || text(record.fileName) || text(record.name);
        const downloadUrl = text(record.download_url) || text(record.downloadUrl) || text(record.url) || text(record.file_url);
        if (!fileName || !downloadUrl.startsWith("https://")) return [];
        return [{ fileName, downloadUrl }];
      });
    },
  };
}

export function smartClientFor(opts: { baseUrl: string; apiKey: string }): SmartClient {
  if (opts.baseUrl.startsWith("fake:")) return createFakeSmartClient();
  return createHttpSmartClient(opts);
}
