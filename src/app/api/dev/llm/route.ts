import { NextResponse } from "next/server";
import { llmConfigured } from "@/lib/flow/model";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ llmConfigured: llmConfigured() });
}
