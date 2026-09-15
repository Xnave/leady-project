import { registerCapability } from "../registry";

/** Document-collection capability pack — tools/persistence wired when product is ready. */
export function registerDocsCapability(): void {
  registerCapability({
    id: "docs",
    sessionFieldKeys: ["docs_requested", "docs_received"],
    closingLines: () => [
      "Docs: ask for documents clearly; never claim a file was reviewed unless a docs tool confirmed it.",
    ],
    promptSection: () => [
      "Document collection capability is enabled but not fully productized yet.",
      "You may ask what documents are needed using reply.",
      "Do not claim files were received or reviewed unless a docs tool confirms it.",
      "If they need a human to review documents, call request_human.",
    ],
  });
}
