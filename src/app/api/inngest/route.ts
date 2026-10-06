import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { inngestFunctions } from "@/inngest/functions";
import { isProductionRuntime } from "@/lib/dev-auth-bypass";

const handlers = serve({
  client: inngest,
  functions: inngestFunctions,
});

/**
 * Inngest Cloud already rejects requests when INNGEST_SIGNING_KEY is missing
 * (SDK validateSignature). Fail closed here too so a misconfigured deploy
 * returns a clear 401 instead of relying on inferred cloud mode alone.
 */
function requireSigningKey<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs) => {
    if (isProductionRuntime() && !(process.env.INNGEST_SIGNING_KEY ?? "").trim()) {
      console.error(
        JSON.stringify({ msg: "inngest.signing_key_missing", status: 401 }),
      );
      return new Response("INNGEST_SIGNING_KEY not configured", { status: 401 });
    }
    return handler(...args);
  };
}

export const GET = requireSigningKey(handlers.GET);
export const POST = requireSigningKey(handlers.POST);
export const PUT = requireSigningKey(handlers.PUT);
