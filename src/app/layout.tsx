import type { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";
import { getUiLang } from "@/lib/cookies";
import "./globals.css";

export const metadata = { title: "Leady" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getUiLang();
  return (
    <html lang={lang} dir={lang === "he" ? "rtl" : "ltr"}>
      <body>
        <div className="shell">
          <AppNav />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
