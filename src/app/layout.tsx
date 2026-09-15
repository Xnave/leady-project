import type { ReactNode } from "react";
import { enUS, heIL } from "@clerk/localizations";
import { ClerkProvider } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/clerk";
import { getUiLang, getUiTheme } from "@/lib/cookies";
import "./globals.css";

export const metadata = { title: "Leady" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [lang, theme] = await Promise.all([getUiLang(), getUiTheme()]);
  const body = isClerkConfigured() ? (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      localization={lang === "he" ? heIL : enUS}
      afterSignOutUrl="/sign-in"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      {children}
    </ClerkProvider>
  ) : (
    children
  );

  return (
    <html
      lang={lang}
      dir={lang === "he" ? "rtl" : "ltr"}
      {...(theme === "system" ? {} : { "data-theme": theme })}
    >
      <body>{body}</body>
    </html>
  );
}
