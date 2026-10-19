import { revalidateTag, unstable_cache } from "next/cache";

/**
 * Which inbound senders this process replies to.
 * Production pauses listed senders. Other Vercel deploys reply only to listed
 * senders. Local dev replies to everyone so the ngrok webhook stays unchanged.
 */
export type ZernioGateMode = "handle-all" | "pause" | "allow";

export function zernioSenderKey(raw: string): string {
  const trimmed = raw.trim().replace(/^@+/, "");
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (!/[a-zA-Z]/.test(trimmed) && digits.length > 0) return digits;
  return trimmed.toLowerCase();
}

export function zernioGateMode(env: { vercel?: string; vercelEnv?: string }): ZernioGateMode {
  if (!env.vercel) return "handle-all";
  if (env.vercelEnv === "production") return "pause";
  return "allow";
}

export function zernioGateModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ZernioGateMode {
  return zernioGateMode({
    vercel: env["VERCEL"],
    vercelEnv: env["VERCEL_ENV"],
  });
}

const SENDER_GATE_TAG = "zernio-sender-gate";

/**
 * Cached until an admin add/remove calls `clearZernioSenderGateCache`.
 * No time-based refresh, so a warm server does not read this table per message.
 */
export const loadZernioSenderKeys = unstable_cache(
  async () => {
    const { prisma } = await import("@/lib/db");
    const rows = await prisma.zernioSenderGate.findMany({ select: { senderKey: true } });
    return rows.map((row) => zernioSenderKey(row.senderKey)).filter((key) => key.length > 0);
  },
  [SENDER_GATE_TAG],
  { tags: [SENDER_GATE_TAG], revalidate: false },
);

/** Drops the cached list. Call only after the gate table changes. */
export function clearZernioSenderGateCache(): void {
  revalidateTag(SENDER_GATE_TAG);
}

/** True when this deploy should persist and reply to `from`. */
export function shouldHandleZernioSender(
  from: string,
  gatedKeys: Iterable<string>,
  mode: ZernioGateMode,
): boolean {
  if (mode === "handle-all") return true;
  const key = zernioSenderKey(from);
  const listed = [...gatedKeys].some((gated) => {
    const normalized = zernioSenderKey(gated);
    return normalized.length > 0 && normalized === key;
  });
  if (mode === "pause") return !listed;
  return key.length > 0 && listed;
}
