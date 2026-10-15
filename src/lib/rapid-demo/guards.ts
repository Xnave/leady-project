import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /\bZD-([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8})\b/i;

export const VISITOR_HOURLY_LIMIT = 20;
export const VISITOR_DAILY_LIMIT = 50;

export type DemoReuseRow = {
  websiteHost: string;
  status: string;
  expiresAt: Date | null;
  code: string;
};

export function rapidDemoSecret(): string {
  return process.env.RAPID_DEMO_API_SECRET?.trim() ?? "";
}

export function rapidDemoAuthorized(authorization: string | null): boolean {
  const secret = rapidDemoSecret();
  if (!secret) return false;
  const token = authorization?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token || token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

export function ipSalt(): string {
  return process.env.RAPID_DEMO_IP_SALT?.trim() || rapidDemoSecret() || "rapid-demo";
}

export function hashIp(ip: string, salt = ipSalt()): string {
  return createHash("sha256").update(`${salt}\n${ip.trim()}`).digest("hex");
}

export function generateDemoCode(): string {
  const bytes = randomBytes(8);
  let code = "ZD-";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return code;
}

export function parseDemoCode(text: string): string | null {
  const match = text.match(CODE_RE);
  if (!match?.[1]) return null;
  return `ZD-${match[1].toUpperCase()}`;
}

export function parseDemoCommand(text: string): "restart" | "tasks" | null {
  const trimmed = text
    .trim()
    .toLowerCase()
    .replace(/^["'״„«»]+|["'״„«»]+$/g, "");
  if (trimmed === "restart" || trimmed === "new" || trimmed === "חדש") return "restart";
  if (trimmed === "tasks" || trimmed === "משימות") return "tasks";
  return null;
}

export function demoTtlMs(): number {
  const raw = Number(process.env.RAPID_DEMO_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 24*7;
  return hours * 60 * 60 * 1000;
}

export function globalHourlyCap(): number {
  return positiveIntEnv("RAPID_DEMO_HOURLY_CAP", 100);
}

export function globalDailyCap(): number {
  return positiveIntEnv("RAPID_DEMO_DAILY_CAP", 500);
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = Number(raw);
  if (!raw?.trim() || !Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function isActiveDemo(row: { status: string; expiresAt: Date | null }, now: Date): boolean {
  return row.status === "active" && row.expiresAt != null && row.expiresAt.getTime() > now.getTime();
}

/** Same host → reuse. Any other live demo for this visitor → conflict. */
export function decideDemoReuse(
  rows: DemoReuseRow[],
  websiteHost: string,
  now: Date,
): { type: "create" } | { type: "reuse"; code: string } | { type: "conflict"; code: string } {
  const active = rows.filter((row) => isActiveDemo(row, now));
  const same = active.find((row) => row.websiteHost === websiteHost);
  if (same) return { type: "reuse", code: same.code };
  if (active[0]) return { type: "conflict", code: active[0].code };
  return { type: "create" };
}

export function rateLimitDecision(counts: {
  visitorHour: number;
  visitorDay: number;
  globalHour: number;
  globalDay: number;
}): "ok" | "rate_limited" | "hourly_cap" | "daily_cap" {
  if (counts.globalHour >= globalHourlyCap()) return "hourly_cap";
  if (counts.globalDay >= globalDailyCap()) return "daily_cap";
  if (counts.visitorHour >= VISITOR_HOURLY_LIMIT || counts.visitorDay >= VISITOR_DAILY_LIMIT) {
    return "rate_limited";
  }
  return "ok";
}

export function fileHost(text: string): string {
  const digest = createHash("sha256").update(text.trim()).digest("hex").slice(0, 12);
  return `file:${digest}`;
}

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".localdomain"];

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "metadata.google.internal" || host === "metadata.google") return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (isIpLiteral(host)) return !isPublicIpAddress(host);
  return false;
}

export function isIpLiteral(hostname: string): boolean {
  return isIpv4(hostname) || hostname.includes(":");
}

function isIpv4(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

export function isPublicIpAddress(ip: string): boolean {
  const host = ip.trim().toLowerCase();
  if (host.includes(":")) return isPublicIpv6(host);
  return isPublicIpv4(host);
}

function isPublicIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0 && nums[2] === 2) return false;
  if (a === 198 && (b === 18 || (b === 51 && nums[2] === 100))) return false;
  if (a === 203 && b === 0 && nums[2] === 113) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, "");
  if (host === "::" || host === "::1") return false;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;
  if (host.startsWith("::ffff:")) {
    const v4 = host.slice("::ffff:".length);
    return isPublicIpv4(v4);
  }
  return host.includes(":") && !host.startsWith("ff");
}

export function htmlToText(html: string, maxChars = 24_000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}
