/**
 * # Capability packs (OCP)
 *
 * The flow interpreter is a closed kernel: stage types, transitions, HITL, nudges.
 * Domain behavior is added by **registering** actions and capabilities — not by
 * editing `interpretTurn`.
 *
 * ## Add a capability (e.g. orders, document review)
 *
 * 1. Create `src/lib/flow/capabilities/<id>.ts` with `registerCapability({ id, promptSection, tools })`.
 * 2. Call the register function from `src/lib/flow/capabilities/index.ts`.
 * 3. Attach it on a talk stage: `capabilities: ["booking", "orders"]` (catalog or custom flow JSON).
 * 4. If you need a durable side effect, `registerAction("create_order", handler)` and
 *    emit `{ type: "create_order", args }` from a tool into `TalkOutcome.effects`.
 *
 * ## Add an action stage
 *
 * Set `ActionStage.action` to your registered id (string). The interpreter looks it up
 * in the ActionRegistry. Built-ins: `book_meeting`, `request_human`.
 *
 * Stubs for future flows (register no-ops until implemented):
 * - `create_order`
 * - `request_document_review`
 */
export {};
