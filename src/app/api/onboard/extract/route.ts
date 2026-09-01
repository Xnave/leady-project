import { NextResponse } from "next/server";
import { extractOnboardDetails } from "@/lib/flow/onboard-extract";
import { llmConfigured } from "@/lib/flow/model";
import { requireTenantId } from "@/lib/tenant";

export async function POST(req: Request) {
  await requireTenantId();
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Empty document" }, { status: 400 });
  }
  if (!llmConfigured()) {
    return NextResponse.json({ extracted: {}, llmConfigured: false });
  }
  try {
    const extracted = await extractOnboardDetails(text);
    return NextResponse.json({ extracted, llmConfigured: true });
  } catch (err) {
    console.error("onboard extract failed", err);
    return NextResponse.json({ error: "Could not extract from the file" }, { status: 502 });
  }
}
