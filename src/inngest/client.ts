import { Inngest } from "inngest";

const inngestDev =
  process.env.INNGEST_DEV === "1" || process.env.INNGEST_DEV === "true";

export const inngest = new Inngest({
  // Kept from the pre-rename name (Leady): changing the app id makes Inngest
  // register a new app and orphans in-flight runs (scheduled nudges).
  id: "leady",
  ...(inngestDev
    ? {
        isDev: true,
        baseUrl: process.env.INNGEST_BASE_URL || "http://127.0.0.1:8288",
      }
    : {}),
});
