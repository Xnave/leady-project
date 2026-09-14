import { Inngest } from "inngest";

const inngestDev =
  process.env.INNGEST_DEV === "1" || process.env.INNGEST_DEV === "true";

export const inngest = new Inngest({
  id: "leady",
  ...(inngestDev
    ? {
        isDev: true,
        baseUrl: process.env.INNGEST_BASE_URL || "http://127.0.0.1:8288",
      }
    : {}),
});
