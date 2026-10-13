import type { Viewport } from "next";
import type { ReactNode } from "react";
import { enUS, heIL } from "@clerk/localizations";
import { ClerkProvider } from "@clerk/nextjs";
import { headers } from "next/headers";
import { clerkClientProxyUrl, isClerkConfigured } from "@/lib/clerk";
import { getUiLang, getUiTheme } from "@/lib/cookies";
import "./globals.css";

export const metadata = { title: "Zapidly" };

/** `viewportFit: cover` makes `env(safe-area-inset-*)` non-zero; theme colours match `--bg`. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0f2f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0b141a" },
  ],
};

/** Prefer London (near Neon eu-west-2); vercel.json also pins regions. */
export const preferredRegion = "lhr1";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [lang, theme, headerStore] = await Promise.all([getUiLang(), getUiTheme(), headers()]);
  const proxyUrl = clerkClientProxyUrl(headerStore.get("host") ?? undefined);
  const body = isClerkConfigured() ? (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      {...(proxyUrl ? { proxyUrl } : {})}
      localization={lang === "he" ? heIL : enUS}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
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
