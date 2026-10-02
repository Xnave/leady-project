import { generateObject, generateText } from "ai";
import { z } from "zod";
import { enPrompts } from "@/lib/copy";
import { isChatLanguage, type ChatLanguage } from "@/lib/flow/locale";
import { chatModel, llmConfigured } from "@/lib/flow/model";

export type OnboardExtract = {
  name?: string;
  phone?: string;
  intro?: string;
  venueAddress?: string;
  venueHours?: string;
  chatLanguage?: ChatLanguage;
};

const extractSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  intro: z.string().optional(),
  venueAddress: z.string().optional(),
  venueHours: z.string().optional(),
  chatLanguage: z.enum(["multi", "en", "he"]).optional(),
});

const MAX_CHARS = 24_000;

function trimField(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

export function normalizeOnboardExtract(raw: OnboardExtract): OnboardExtract {
  const chatLanguage = raw.chatLanguage && isChatLanguage(raw.chatLanguage)
    ? raw.chatLanguage
    : undefined;
  return {
    name: trimField(raw.name),
    phone: trimField(raw.phone),
    intro: trimField(raw.intro),
    venueAddress: trimField(raw.venueAddress),
    venueHours: trimField(raw.venueHours),
    chatLanguage,
  };
}

export function applyOnboardExtract<T extends OnboardExtract>(
  current: T,
  extracted: OnboardExtract,
): T {
  const next = { ...current };
  const clean = normalizeOnboardExtract(extracted);
  if (clean.name) next.name = clean.name;
  if (clean.phone) next.phone = clean.phone;
  if (clean.intro) next.intro = clean.intro;
  if (clean.venueAddress) next.venueAddress = clean.venueAddress;
  if (clean.venueHours) next.venueHours = clean.venueHours;
  if (clean.chatLanguage) next.chatLanguage = clean.chatLanguage;
  return next;
}

/** Draft a first-message intro when the document had no ready-made greeting. */
export async function synthesizeIntroFromDocument(document: string): Promise<string | undefined> {
  const text = document.trim().slice(0, MAX_CHARS);
  if (!text || !llmConfigured()) return undefined;
  const { text: intro } = await generateText({
    model: chatModel(),
    system:
      "You write the first WhatsApp/chat message a front-desk agent sends for this business. " +
      "1–3 short sentences, same language as the document, warm and natural. " +
      "Greet, say who you are / what the business does, invite them to share what they need. " +
      "No markdown, no bullet list, no quotes around the whole message. Output only the message text.",
    prompt: text,
  });
  return trimField(intro);
}

export async function extractOnboardDetails(document: string): Promise<OnboardExtract> {
  const text = document.trim().slice(0, MAX_CHARS);
  if (!text || !llmConfigured()) return {};
  const { object } = await generateObject({
    model: chatModel(),
    schema: extractSchema,
    system: enPrompts.extractOnboard,
    prompt: text,
  });
  const extracted = normalizeOnboardExtract(object);
  if (extracted.intro) return extracted;
  const intro = await synthesizeIntroFromDocument(text);
  return intro ? { ...extracted, intro } : extracted;
}
