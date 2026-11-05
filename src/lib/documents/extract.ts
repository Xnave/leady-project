import { generateObject } from "ai";
import { z } from "zod";
import { chatModel, llmConfigured } from "@/lib/flow/model";

const extractSchema = z.object({
  docType: z.string(),
  fields: z.record(z.string(), z.string()),
});

export type DocExtraction = {
  docType: string;
  fields: Record<string, string>;
  /**
   * Set when the file was not shown to the model. An empty docType without this
   * means the model ran and the file matched none of the open types.
   */
  unread?: "no_model" | "extract_failed";
  error?: string;
};

/**
 * Vision step: name the document and pull the fields the rules will check.
 * Pass/fail stays in the rules engine.
 */
export async function extractDocument(opts: {
  bytes: Buffer;
  mime: string;
  filename: string;
  open: { docType: string; label: string; fields: string[] }[];
}): Promise<DocExtraction> {
  if (!opts.open.length) return { docType: "", fields: {} };
  if (!llmConfigured()) {
    console.warn(JSON.stringify({
      msg: "documents.extract_skipped",
      filename: opts.filename,
      mime: opts.mime,
      reason: "no_model",
    }));
    return { docType: "", fields: {}, unread: "no_model" };
  }
  const catalog = opts.open
    .map((item) => `${item.docType} (${item.label}): ${item.fields.join(", ") || "no fields"}`)
    .join("\n");
  try {
    const { object } = await generateObject({
      model: chatModel(),
      schema: extractSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Identify this file as one of the open document types, or an empty docType if it is none of them.",
                "Extract only the listed fields. Dates as YYYY-MM-DD. Leave unknown fields empty.",
                "For months, list every YYYY-MM the file covers, comma-separated. One file may cover several months. Never include the current calendar month.",
                catalog,
              ].join("\n"),
            },
            {
              type: "file",
              data: opts.bytes,
              filename: opts.filename,
              mediaType: opts.mime || "application/octet-stream",
            },
          ],
        },
      ],
    });
    const allowed = new Set(opts.open.map((item) => item.docType));
    const named = object.docType.trim();
    return {
      docType: allowed.has(object.docType) ? object.docType : named,
      fields: object.fields,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(JSON.stringify({
      msg: "documents.extract_failed",
      filename: opts.filename,
      mime: opts.mime,
      error,
    }));
    return { docType: "", fields: {}, unread: "extract_failed", error };
  }
}
