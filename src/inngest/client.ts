import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "leady",
  isDev: process.env.NODE_ENV !== "production",
});
