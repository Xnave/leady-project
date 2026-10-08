import type { TurnContext } from "@/lib/flow/types";
import { DEFAULT_PERSONA } from "./presets";
import type { Persona } from "./types";

export function personaOf(ctx: Pick<TurnContext, "agent">): Persona {
  return ctx.agent.persona ?? DEFAULT_PERSONA;
}
