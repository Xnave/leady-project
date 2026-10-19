import { generateText } from "ai";
import { prisma } from "@/lib/db";
import { chatModel, llmConfigured } from "@/lib/flow/model";
import { isChatLanguage, resolveReplyLanguage } from "@/lib/flow/locale";
import { stripDemoFooter } from "@/lib/rapid-demo/copy";

/** Free-text LLM summary of one conversation. No structured fields. */
export async function summarizeConversation(conversationId: string): Promise<string> {
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { id: conversationId },
    include: {
      tenant: true,
      messages: { orderBy: { createdAt: "asc" }, take: 80 },
    },
  });

  const transcript = conversation.messages
    .map((m) => `${m.role}: ${stripDemoFooter(m.text)}`)
    .join("\n")
    .trim();
  if (!transcript) return "";

  const policy = isChatLanguage(conversation.tenant.chatLanguage)
    ? conversation.tenant.chatLanguage
    : "multi";
  const lastLead =
    [...conversation.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
  const lang = resolveReplyLanguage(policy, lastLead);
  const langLine =
    lang === "he"
      ? "Write the summary in Hebrew."
      : "Write the summary in English.";

  // Without an LLM key the app runs on heuristics; a handoff then carries no summary.
  if (!llmConfigured()) return "";

  const { text } = await generateText({
    model: chatModel(),
    system: [
      "Summarize this customer conversation for a human teammate in the inbox.",
      "One short paragraph of prose only. No bullet lists, no JSON, no field labels.",
      "Include intent, key facts they shared, and what is still open or waiting.",
      "If they answered yes to the last confirmation, say they confirmed those details. Do not describe that yes as still unfinished. A teammate may still need to approve; that is separate from the customer's agreement.",
      langLine,
    ].join(" "),
    prompt: transcript,
  });

  const summary = text.trim();
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { summary },
  });
  return summary;
}
