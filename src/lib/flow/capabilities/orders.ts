import { registerCapability } from "../registry";

/** Orders capability pack — tools/persistence wired when product is ready. */
export function registerOrdersCapability(): void {
  registerCapability({
    id: "orders",
    sessionFieldKeys: ["order_draft", "order_confirm"],
    closingLines: () => [
      "Orders: only collect or confirm order details when the orders capability tools are used; never invent order confirmations.",
    ],
    promptSection: () => [
      "Orders capability is enabled but not fully productized yet.",
      "Answer product questions with reply. Do not invent order placement or payment flows.",
      'If they clearly want to place an order, say a teammate will follow up — or call request_human if they insist.',
    ],
  });
}
