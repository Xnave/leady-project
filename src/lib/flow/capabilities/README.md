/**
 * # Capability packs (OCP)
 *
 * The flow interpreter is a **closed kernel**: stage types, transitions, HITL, nudges,
 * and generic dispatch. It names no business domain, and `architecture.test.ts`
 * ("kernel purity") fails if one creeps back in. Domain behavior is added by
 * **registering** — never by editing `interpretTurn`.
 *
 * ## Lifecycle hooks
 *
 * `registerCapability({ … })` accepts:
 *
 * | Hook | Purpose |
 * |---|---|
 * | `promptSection` | Extra system-prompt lines while this capability is active |
 * | `closingLines` | Closing guardrails appended after the prompt sections |
 * | `tools` | LLM tools the model may call this turn |
 * | `reconcile` | Enforce invariants after the talk turn, before effects run |
 * | `loadState` | Load durable rows onto `ctx.capabilityState[id]` during `loadTurnContext` |
 * | `decide` | Apply an operator approve / decline / reschedule (keeps API routes generic) |
 * | `sessionFieldKeys` | Static keys that live on `Conversation.session` |
 * | `dynamicSessionKeys` | Per-tenant session keys derived from config |
 *
 * Read loaded state with `capabilityState<T>(ctx, "<id>")`.
 *
 * ## Add a capability
 *
 * 1. Create `src/lib/flow/capabilities/<id>.ts` calling `registerCapability`.
 * 2. Call its register function from `capabilities/index.ts`.
 * 3. Attach it on a talk stage: `capabilities: ["booking", "<id>"]`.
 * 4. For a durable "submit for human approval" side effect, `registerAction("<effect>", handler)`
 *    plus `registerApprovalEffect({ effectId, capabilityId })` — that pair covers the
 *    whole park-on-waiting_human flow, so do not hand-roll a talk effect for it.
 *
 * Describe what you collect as a `FieldSpec[]` (see `../fields/`) rather than branching
 * on field ids: each field *type* implements ask / normalize / gaps / render once.
 *
 * ## Ports
 *
 * Capabilities must not import `prisma`. Row writes belong in a domain module
 * (`@/lib/requests`, plus a thin vertical wrapper like `@/lib/meetings`) which the
 * capability calls. The interpreter reaches durable work through one generic port,
 * `runEffect`, so adding a capability never adds a port.
 *
 * ## Add an action stage
 *
 * Set `ActionStage.action` to a registered id. `request_human` is kernel policy
 * (HITL gating) and is handled in the interpreter; everything else resolves through
 * the action registry.
 *
 * Current packs:
 * - `booking` — point-in-time requests (`Request` with `kind` from the instance, default "visit")
 * - `reservations` — date-span requests + configurable link-probe availability (nouns from instance config)
 */
export {};
