/**
 * # Capability packs (OCP)
 *
 * The flow interpreter is a closed kernel: stage types, transitions, HITL, nudges,
 * and generic talk-effect dispatch via `registerTalkEffect`.
 * Domain behavior is added by **registering** actions and capabilities — not by
 * editing `interpretTurn` for each business type.
 *
 * ## Add a capability (e.g. orders, document review)
 *
 * 1. Create `src/lib/flow/capabilities/<id>.ts` with `registerCapability({ id, promptSection, tools?, sessionFieldKeys?, closingLines? })`.
 * 2. Call the register function from `src/lib/flow/capabilities/index.ts`.
 * 3. Attach it on a talk stage: `capabilities: ["booking", "orders"]` (onboard toggles or flow JSON).
 * 4. If you need a durable side effect, `registerAction` / `registerTalkEffect` and
 *    emit `{ type: "…", args }` from a tool into `TalkOutcome.effects`.
 *
 * ## Add an action stage
 *
 * Set `ActionStage.action` to your registered id (string). The interpreter looks it up
 * in the ActionRegistry. Built-ins: `book_meeting`, `request_human`.
 *
 * Peer packs (prompt stubs until productized):
 * - `orders` + action `create_order`
 * - `docs` + action `request_document_review`
 */
export {};
