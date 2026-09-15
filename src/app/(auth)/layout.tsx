import type { ReactNode } from "react";

/** Auth routes: login / no-access only — no CRM chrome. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="auth-shell">{children}</div>;
}
