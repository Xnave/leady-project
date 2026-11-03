/**
 * Profile a Smart NPV account's client list for client campaigns, without
 * keeping any personal data. Pages through `clients/list` (read-only) and
 * prints aggregates only: counts per year, fill rate of every date-like
 * field (top-level and nested, e.g. `liabilities[].start_date`), status /
 * archive / transaction-type distributions, phone quality, and how a
 * derived `deal_date` would fall for a refinance window.
 *
 * Nothing is written to disk and no name, phone, id number or free text is
 * printed. Field names and coded values (status ids, years) are printed.
 *
 * Usage:
 *   SMARTNPV_API_KEY=... npx tsx scripts/smartnpv-profile.ts [--page-size 100] [--max-pages 200]
 *
 * SMARTNPV_BASE_URL defaults to https://www.snpv.co.il. The key is the
 * tenant's Smart NPV API key (extended subscription). Treat the output as
 * internal: it describes one business's client book.
 */

type Row = Record<string, unknown>;

const DATE_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$|^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/;

/** Smart NPV dates arrive as DD/MM/YYYY[ HH:MM]; ISO is accepted too. Zero dates are empty. */
function parseSmartDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.startsWith("0000") || v.startsWith("00/00")) return null;
  const m = v.match(DATE_RE);
  if (!m) return null;
  const [d, mo, y] = m[3] ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[6]), Number(m[5]), Number(m[4])];
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function filled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "" && !value.startsWith("0000");
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sorted(map: Map<string, number>, limit = 40): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit));
}

function byKey(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/** Every path in a record whose value parses as a date, e.g. `liabilities[].start_date`. */
function datePaths(value: unknown, prefix: string, out: Map<string, Date>) {
  if (Array.isArray(value)) {
    for (const item of value) datePaths(item, `${prefix}[]`, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Row)) datePaths(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  const d = parseSmartDate(value);
  if (d && !out.has(prefix)) out.set(prefix, d);
}

function phoneKind(raw: unknown): "mobile" | "other" | "missing" {
  if (typeof raw !== "string" || !raw.trim()) return "missing";
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("972")) d = `0${d.slice(3)}`;
  return /^05\d{8}$/.test(d) ? "mobile" : "other";
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ddmmyyyy(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** Default derivation order from the client-campaigns design; status gating is left out (statuses unknown). */
const DEAL_CHAIN: { field: string; offsetMonths: number }[] = [
  { field: "last_date_execution", offsetMonths: 0 },
  { field: "archive_time", offsetMonths: 0 },
  { field: "client_contract_date", offsetMonths: 3 },
  { field: "last_documentation", offsetMonths: 0 },
  { field: "created", offsetMonths: 3 },
];

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // no .env: rely on the environment
  }
  const apiKey = (process.env.SMARTNPV_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("Set SMARTNPV_API_KEY (the tenant's Smart NPV API key)");
  const base = (process.env.SMARTNPV_BASE_URL ?? "https://www.snpv.co.il").replace(/\/$/, "");
  const root = /\/api\/v2$/.test(base) ? base : `${base}/api/v2`;
  const pageSize = arg("--page-size", 100);
  const maxPages = arg("--max-pages", 200);
  const now = new Date();

  let reportedCount: number | null = null;
  let total = 0;
  const createdYear = new Map<string, number>();
  const phone = new Map<string, number>();
  const archive = new Map<string, number>();
  const status = new Map<string, number>();
  const statusByArchive = new Map<string, number>();
  const txType = new Map<string, number>();
  const leadFlag = new Map<string, number>();
  const allKeys = new Map<string, number>();
  const dateFill = new Map<string, number>();
  const dateFillByCreatedYear = new Map<string, Map<string, number>>();
  const dateYears = new Map<string, Map<string, number>>();
  const dealSource = new Map<string, number>();
  const dealInWindow = new Map<string, number>();
  const dealYear = new Map<string, number>();

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      api_key: apiKey,
      range_type: "1",
      from: "01/01/2000",
      until: ddmmyyyy(now),
      limit: String(pageSize),
      offset: String(page * pageSize),
    });
    const res = await fetch(`${root}/clients/list?${qs}`);
    if (!res.ok) throw new Error(`clients/list ${res.status}`);
    const body = (await res.json()) as { response?: boolean; responseMessage?: string; responseClientsCount?: number; responseClients?: Row[] };
    if (body.response === false) throw new Error(body.responseMessage || "clients/list failed");
    if (typeof body.responseClientsCount === "number") reportedCount = body.responseClientsCount;
    const rows = body.responseClients ?? [];

    for (const row of rows) {
      total++;
      for (const k of Object.keys(row)) if (filled(row[k])) bump(allKeys, k);
      const created = parseSmartDate(row.created);
      const cy = created ? String(created.getUTCFullYear()) : "unknown";
      bump(createdYear, cy);
      bump(phone, phoneKind(row.phone_1));
      const arch = String(row.archive ?? "").trim() || "empty";
      bump(archive, arch);
      const st = `${String(row.status_id ?? "").trim() || "-"}|${String(row.status_title ?? "").trim() || "-"}`;
      bump(status, st);
      bump(statusByArchive, `archive=${arch} status=${st}`);
      bump(txType, String(row.transaction_type ?? "").trim() || "empty");
      bump(leadFlag, String(row.lead ?? "").trim() || "empty");

      const dates = new Map<string, Date>();
      datePaths(row, "", dates);
      for (const [path, d] of dates) {
        bump(dateFill, path);
        if (!dateFillByCreatedYear.has(path)) dateFillByCreatedYear.set(path, new Map());
        bump(dateFillByCreatedYear.get(path)!, cy);
        if (!dateYears.has(path)) dateYears.set(path, new Map());
        bump(dateYears.get(path)!, String(d.getUTCFullYear()));
      }

      let deal: Date | null = null;
      let source = "none";
      for (const step of DEAL_CHAIN) {
        const d = parseSmartDate(row[step.field]);
        if (!d) continue;
        deal = new Date(d);
        deal.setUTCMonth(deal.getUTCMonth() + step.offsetMonths);
        source = step.field;
        break;
      }
      bump(dealSource, source);
      if (deal) {
        bump(dealYear, String(deal.getUTCFullYear()));
        const years = (now.getTime() - deal.getTime()) / (365.25 * 24 * 3600 * 1000);
        if (years >= 4.5 && years <= 10) bump(dealInWindow, source);
      }
    }

    process.stderr.write(`page ${page + 1}: ${rows.length} rows (total ${total}${reportedCount != null ? ` of ${reportedCount}` : ""})\n`);
    if (rows.length < pageSize) break;
    if (reportedCount != null && total >= reportedCount) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  const nested = new Map<string, Record<string, number>>();
  for (const [path, m] of dateFillByCreatedYear) nested.set(path, byKey(m));

  console.log(
    JSON.stringify(
      {
        checkedAt: now.toISOString(),
        clients: total,
        reportedCount,
        createdYear: byKey(createdYear),
        phone_1: sorted(phone),
        archive: sorted(archive),
        status: sorted(status),
        statusByArchive: sorted(statusByArchive, 60),
        transaction_type: sorted(txType),
        lead: sorted(leadFlag),
        filledKeys: sorted(allKeys, 200),
        datePaths: Object.fromEntries(
          [...dateFill.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([path, n]) => [path, { filled: n, byCreatedYear: nested.get(path), valueYears: byKey(dateYears.get(path)!) }]),
        ),
        dealDate: {
          note: "Default chain, no status gating. In-window = 4.5 to 10 years before now.",
          source: sorted(dealSource),
          inRefinanceWindow: sorted(dealInWindow),
          year: byKey(dealYear),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
