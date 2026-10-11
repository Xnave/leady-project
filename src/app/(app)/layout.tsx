import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/** Run CRM RSC near Neon (eu-west-2) - was iad1 and paid ~1.5s/query RTT. */
export const preferredRegion = "lhr1";

/** CRM routes: sidebar + app chrome only after auth middleware. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
