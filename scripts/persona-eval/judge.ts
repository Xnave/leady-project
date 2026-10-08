import { generateObject } from "ai";
import { z } from "zod";
import { chatModel } from "@/lib/flow/model";
import { personaSection } from "@/lib/persona/prompt";
import type { Persona } from "@/lib/persona/types";

export const Score = z.object({
  human: z.number().int().min(1).max(5),
  personaMatch: z.number().int().min(1).max(5),
  helpful: z.number().int().min(1).max(5),
  length: z.number().int().min(1).max(5),
  hebrewGender: z.number().int().min(1).max(5).nullable(),
  rulesRespected: z.boolean(),
  note: z.string(),
});
export type Score = z.infer<typeof Score>;

/** One strict LLM grade per agent reply. Same rubric for every arm, so baseline is judged against the target persona too. */
export async function judge(o: {
  persona: Persona;
  lang: "en" | "he";
  knowledge: string;
  expect: string;
  transcript: { role: string; text: string }[];
  reply: string;
}): Promise<Score> {
  const { object } = await generateObject({
    model: chatModel(),
    schema: Score,
    temperature: 0,
    system: [
      "You grade ONE reply from a business's WhatsApp agent. Be strict and consistent across replies.",
      "human (1-5): 5 = indistinguishable from a skilled, warm human rep; 1 = robotic, canned, template-like.",
      "personaMatch (1-5): how well the reply follows this persona spec:",
      personaSection(o.persona, o.lang),
      "helpful (1-5): answers what was asked, correct per knowledge, gives a clear next step.",
      "length (1-5): 5 = respects the persona's length rule exactly.",
      "hebrewGender (1-5 or null): only for Hebrew replies, else null. Agent self-reference matches the persona's gender; the customer is addressed gender-neutrally until they reveal their gender, then matched. 5 = perfect.",
      "rulesRespected (bool): false if it invents prices/terms/facts not in knowledge, says a meeting is confirmed, or starts collecting booking details when the customer only showed interest.",
      `Scenario expectation: ${o.expect}`,
      `Knowledge:\n${o.knowledge}`,
    ].join("\n"),
    prompt: JSON.stringify({ transcript: o.transcript, reply: o.reply }),
  });
  return object;
}
