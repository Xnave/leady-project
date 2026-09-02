import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { UI_LANG_COOKIE } from "@/lib/cookies";
import { isUiLang } from "@/lib/ui";
import { redirectPath } from "@/lib/request-url";

export async function POST(req: Request) {
  const form = await req.formData();
  const lang = String(form.get("lang") ?? "");
  if (!isUiLang(lang)) {
    return NextResponse.redirect(redirectPath(req, "/"), 303);
  }
  const jar = await cookies();
  jar.set(UI_LANG_COOKIE, lang, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  const back = req.headers.get("referer") ?? "/";
  return NextResponse.redirect(back, 303);
}
