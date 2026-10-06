import { NextResponse } from "next/server";
import { getUiLang } from "@/lib/cookies";
import { extractOnboardDetails } from "@/lib/flow/onboard-extract";
import { llmConfigured } from "@/lib/flow/model";
import { RATE_LIMITS, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { tenantRoleOr403 } from "@/lib/tenant-role";
import { fillUi, uiCopy } from "@/lib/ui";

export async function POST(req: Request) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Empty document" }, { status: 400 });
  }
  if (!llmConfigured()) {
    return NextResponse.json({ extracted: {}, llmConfigured: false });
  }
  const limited = await rateLimit(`onboard-extract:${access.tenantId}`, RATE_LIMITS.onboardExtract);
  if (!limited.ok) {
    const ui = uiCopy(await getUiLang());
    return tooManyRequests(limited, fillUi(ui.errors.rateLimited, { seconds: limited.retryAfterSec }));
  }
  try {
    const extracted = await extractOnboardDetails(text);
    return NextResponse.json({ extracted, llmConfigured: true });
  } catch (err) {
    console.error("onboard extract failed", err);
    return NextResponse.json({ error: "Could not extract from the file" }, { status: 502 });
  }
}
