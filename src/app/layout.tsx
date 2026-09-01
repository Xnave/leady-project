import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { getUiLang } from "@/lib/cookies";
import "./globals.css";

export const metadata = { title: "Leady" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getUiLang();
  return (
    <html lang={lang} dir={lang === "he" ? "rtl" : "ltr"}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
