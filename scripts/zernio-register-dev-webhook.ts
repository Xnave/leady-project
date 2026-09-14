/**
 * Register a second Zernio webhook pointing at local dev (ngrok).
 * Usage: pnpm exec tsx scripts/zernio-register-dev-webhook.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  createZernioWebhookSettings,
  listZernioWebhookSettings,
  zernioWebhookSecret,
} from "../src/lib/zernio";

function loadDotEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    out[key] = value;
  }
  return out;
}

async function main() {
  const root = path.join(import.meta.dirname, "..");
  const env = loadDotEnv(path.join(root, ".env"));
  for (const [k, v] of Object.entries(env)) {
    if (v && !process.env[k]) process.env[k] = v;
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  if (!appUrl.startsWith("https://")) {
    console.error("Set NEXT_PUBLIC_APP_URL to your ngrok https URL in .env, then retry.");
    process.exit(1);
  }

  const webhookUrl = `${appUrl}/api/webhooks/zernio`;
  const existing = await listZernioWebhookSettings();
  const dup = existing.find((w) => w.url === webhookUrl);
  if (dup) {
    console.log("Webhook already registered:", dup.name, dup.url, dup._id);
    return;
  }

  const secret = zernioWebhookSecret();
  const webhook = await createZernioWebhookSettings({
    name: `Leady local dev ${new Date().toISOString().slice(0, 10)}`,
    url: webhookUrl,
    events: ["message.received"],
    ...(secret ? { secret } : {}),
  });

  console.log("Created webhook:", webhook.name);
  console.log("  url:", webhook.url);
  console.log("  id:", webhook._id);
  if (!secret) {
    console.log("  (no ZERNIO_WEBHOOK_SECRET — signature verification disabled locally)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
