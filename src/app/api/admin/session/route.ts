import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { expectedAdminToken, secretMatches } from "@/lib/admin";
import { ADMIN_COOKIE } from "@/lib/cookies";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { secret?: string };
  if (!secretMatches(String(body.secret ?? ""))) {
    return NextResponse.json({ error: "Bad secret" }, { status: 401 });
  }
  const token = expectedAdminToken();
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
  });
  return NextResponse.json({ ok: true });
}
