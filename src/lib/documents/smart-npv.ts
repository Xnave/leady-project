import type { Profile } from "./rules";

export type SmartClientHit = { clientId: string; profile: Profile };

/**
 * The only module that speaks HTTP to SmartNPV.
 * Paths are a stand-in until a captured API example replaces them:
 * POST {baseUrl}/clients/lookup
 * POST {baseUrl}/clients/{clientId}/documents
 */
export type SmartClient = {
  findClient(query: { phone?: string; nationalId?: string }): Promise<SmartClientHit | null>;
  upload(opts: {
    clientId: string;
    docType: string;
    filename: string;
    mime: string;
    bytes: Buffer;
  }): Promise<{ remoteId: string }>;
};

export const FAKE_SMART_PROFILE: Profile = {
  employment: "employed",
  hasLoans: true,
  nationalId: "123456782",
  fullName: "Dana Levi",
};

/** Map a raw SmartNPV payload onto the keys the rules document reads. */
export function mapSmartProfile(raw: Record<string, unknown>): Profile {
  const loans = raw.loans;
  const hasLoans =
    typeof raw.hasLoans === "boolean"
      ? raw.hasLoans
      : typeof raw.has_loans === "boolean"
        ? raw.has_loans
        : Array.isArray(loans) && loans.length > 0;
  const employment = raw.employment ?? raw.employmentType ?? raw.employment_type ?? "";
  const nationalId = raw.nationalId ?? raw.national_id ?? raw.tz ?? raw.idNumber ?? "";
  const fullName = raw.fullName ?? raw.full_name ?? raw.name ?? "";
  const phone = raw.phone ?? "";
  return {
    employment: typeof employment === "string" ? employment : String(employment ?? ""),
    hasLoans: Boolean(hasLoans),
    nationalId: String(nationalId ?? ""),
    fullName: String(fullName ?? ""),
    phone: String(phone ?? ""),
  };
}

export function createFakeSmartClient(profile: Profile = FAKE_SMART_PROFILE): SmartClient {
  return {
    async findClient(query) {
      if (!query.phone && !query.nationalId) return null;
      return { clientId: "fake-client", profile: { ...profile, phone: query.phone ?? profile.phone } };
    },
    async upload(opts) {
      return { remoteId: `fake-${opts.docType}` };
    },
  };
}

export function createHttpSmartClient(opts: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }): SmartClient {
  const base = opts.baseUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    authorization: `Bearer ${opts.apiKey}`,
    "content-type": "application/json",
  };
  return {
    async findClient(query) {
      const res = await fetchImpl(`${base}/clients/lookup`, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone: query.phone ?? "", nationalId: query.nationalId ?? "" }),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`smart lookup ${res.status}`);
      const body = (await res.json()) as { clientId?: string; profile?: Record<string, unknown> };
      if (!body.clientId || !body.profile) return null;
      return { clientId: body.clientId, profile: mapSmartProfile(body.profile) };
    },
    async upload(input) {
      const res = await fetchImpl(`${base}/clients/${encodeURIComponent(input.clientId)}/documents`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          docType: input.docType,
          filename: input.filename,
          mime: input.mime,
          dataBase64: input.bytes.toString("base64"),
        }),
      });
      if (!res.ok) throw new Error(`smart upload ${res.status}`);
      const body = (await res.json()) as { remoteId?: string };
      if (!body.remoteId) throw new Error("smart upload missing remoteId");
      return { remoteId: body.remoteId };
    },
  };
}

export function smartClientFor(opts: { baseUrl: string; apiKey: string }): SmartClient {
  if (opts.baseUrl.startsWith("fake:")) return createFakeSmartClient();
  return createHttpSmartClient(opts);
}
