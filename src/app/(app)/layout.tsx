import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { pendingAgreement } from "@/lib/legal/agreement";

/** Run CRM RSC near Neon (eu-west-2) - was iad1 and paid ~1.5s/query RTT. */
export const preferredRegion = "lhr1";

/** CRM routes: sidebar + app chrome only after auth middleware, and only once the owner accepted the agreement. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  if (await pendingAgreement()) redirect("/accept-agreement");
  return <AppShell>{children}</AppShell>;
}
