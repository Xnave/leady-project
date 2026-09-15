import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/** CRM routes: sidebar + app chrome only after auth middleware. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
