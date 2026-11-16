import { isProductionRuntime } from "@/lib/dev-auth-bypass";

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  code?: unknown;
  clientVersion?: unknown;
  meta?: unknown;
  cause?: unknown;
};

function serializeError(err: unknown, depth = 0): unknown {
  if (!(err instanceof Error)) return { message: String(err) };
  const value = err as Error & ErrorLike;
  const details: Record<string, unknown> = {
    name: value.name,
    message: value.message,
    stack: value.stack,
  };
  if (value.code !== undefined) details.code = value.code;
  if (value.clientVersion !== undefined) details.clientVersion = value.clientVersion;
  if (value.meta !== undefined) details.meta = value.meta;
  if (depth < 3 && value.cause !== undefined) details.cause = serializeError(value.cause, depth + 1);
  return details;
}

/** Structured error logging. Full stacks/messages are emitted locally; production logs keep safe identifiers only. */
export function logError(msg: string, err: unknown, context: Record<string, unknown> = {}): void {
  const value = err && typeof err === "object" ? err as ErrorLike : {};
  const fullDetails = !isProductionRuntime() || process.env.LOG_FULL_ERRORS === "true";
  const error = fullDetails
    ? serializeError(err)
    : {
        name: typeof value.name === "string" ? value.name : "UnknownError",
        ...(typeof value.code === "string" ? { code: value.code } : {}),
        message: "See local development logs for full error details.",
      };
  console.error(JSON.stringify({ msg, ...context, error }));
}
