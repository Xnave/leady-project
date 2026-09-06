import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { UI_THEME_COOKIE } from "@/lib/cookies";
import { isUiTheme } from "@/lib/ui";
import { redirectPath, refererRedirect } from "@/lib/request-url";

export async function POST(req: Request) {
  const form = await req.formData();
  const theme = String(form.get("theme") ?? "");
  if (!isUiTheme(theme)) {
    return NextResponse.redirect(redirectPath(req, "/"), 303);
  }
  const jar = await cookies();
  jar.set(UI_THEME_COOKIE, theme, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.redirect(refererRedirect(req), 303);
}
