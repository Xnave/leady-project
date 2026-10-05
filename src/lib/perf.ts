import { AsyncLocalStorage } from "node:async_hooks";

/** Per-turn phase timings collected into the `runAgentTurn` exit log. */
export type TurnPerf = {
  load_ms?: number;
  load_convo_ms?: number;
  load_instances_ms?: number;
  load_capability_state_ms?: number;
  interpret_ms?: number;
  talk_llm_ms?: number;
  talk_steps?: number;
  talk_prompt_chars?: number;
  tools_used?: string[];
  classify_ms?: number;
  extract_ms?: number;
  draft_ms?: number;
  faq_ms?: number;
  effect_ms?: number;
  summarize_ms?: number;
  persist_ms?: number;
  send_ms?: number;
  refresh_ms?: number;
};

const turnStore = new AsyncLocalStorage<TurnPerf>();

export function runWithTurnPerf<T>(fn: () => Promise<T>): Promise<{ result: T; perf: TurnPerf }> {
  const perf: TurnPerf = {};
  return turnStore.run(perf, async () => {
    const result = await fn();
    return { result, perf };
  });
}

export function addTurnPerf(patch: Partial<TurnPerf>) {
  const store = turnStore.getStore();
  if (!store) return;
  for (const [k, v] of Object.entries(patch) as [keyof TurnPerf, TurnPerf[keyof TurnPerf]][]) {
    if (v == null) continue;
    if (k === "tools_used" && Array.isArray(v)) {
      store.tools_used = [...(store.tools_used ?? []), ...v];
      continue;
    }
    if (typeof v === "number") {
      const prev = store[k];
      store[k] = (typeof prev === "number" ? prev + v : v) as never;
    }
  }
}

export async function timeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - started };
}

function alwaysLogPerf(): boolean {
  return process.env.PERF_LOG === "1" || Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

/** CRM / page-load timing. Always on in production so Vercel Runtime Logs can split DB vs RSC. */
export function logCrmPerf(
  msg: string,
  fields: Record<string, unknown>,
  opts?: { thresholdMs?: number; force?: boolean },
) {
  const force = opts?.force || alwaysLogPerf();
  const threshold = opts?.thresholdMs ?? 50;
  const total = typeof fields.ms === "number" ? fields.ms : 0;
  if (!force && total < threshold) return;
  console.log(JSON.stringify({ msg, ...fields }));
}
