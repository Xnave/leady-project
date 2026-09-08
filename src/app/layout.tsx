import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { getUiLang, getUiTheme } from "@/lib/cookies";
import "./globals.css";

export const metadata = { title: "Leady" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [lang, theme] = await Promise.all([getUiLang(), getUiTheme()]);
  return (
    <html
      lang={lang}
      dir={lang === "he" ? "rtl" : "ltr"}
      {...(theme === "system" ? {} : { "data-theme": theme })}
    >
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
