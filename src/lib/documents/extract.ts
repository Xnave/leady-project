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
  if (!opts.open.length || !llmConfigured()) return { docType: "", fields: {} };
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
    return {
      docType: allowed.has(object.docType) ? object.docType : object.docType.trim() ? object.docType.trim() : "",
      fields: object.fields,
    };
  } catch {
    return { docType: "", fields: {} };
  }
}
