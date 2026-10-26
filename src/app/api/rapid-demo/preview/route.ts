import { NextResponse } from "next/server";
import { rapidDemoAuthorized } from "@/lib/rapid-demo/guards";
import { previewRapidDemo } from "@/lib/rapid-demo/service";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!rapidDemoAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: {
    website?: string;
    text?: string;
    capabilities?: unknown;
    company?: string;
    clientIp?: string;
    browserId?: string;
    bypass?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.company === "string" && body.company.trim()) {
    return NextResponse.json({ ok: true });
  }
  try {
    const result = await previewRapidDemo(body);
    return NextResponse.json(result, { status: result.ok ? 200 : statusFor(result.error) });
  } catch (err) {
    console.error(JSON.stringify({ msg: "rapid_demo.preview_failed", error: String(err) }));
    return NextResponse.json({ ok: false, error: "preview_failed" }, { status: 500 });
  }
}

function statusFor(error: string): number {
  if (error === "rate_limited" || error === "hourly_cap" || error === "daily_cap") return 429;
  if (error === "demo_exists") return 409;
  return 422;
}
