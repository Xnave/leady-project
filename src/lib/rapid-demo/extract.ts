import { GoogleGenAI } from "@google/genai";
import { isCapabilityId, type CapabilityId } from "@/lib/flow/catalog";
import { isChatLanguage, looksHebrew, type ChatLanguage } from "@/lib/flow/locale";
import { geminiApiKey } from "@/lib/flow/model";
import { extractOnboardDetails, type OnboardExtract } from "@/lib/flow/onboard-extract";
import { DEMO_ACTIVATION_NOTE } from "./copy";
import { parsePublicHttpsUrl } from "./fetch-site";

const MAX_CHARS = 24_000;

export const RAPID_DEMO_RESEARCH_MODEL = "gemini-3.8-flash";

export function rapidDemoResearchModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.RAPID_DEMO_RESEARCH_MODEL?.trim() || RAPID_DEMO_RESEARCH_MODEL;
}

export type RapidExtract = OnboardExtract & {
  chatLanguage: ChatLanguage;
  capabilities: CapabilityId[];
  knowledgeMd: string;
  /** Fetched page or uploaded file, kept so a later name can still drive research. */
  pageText: string;
  websiteUrl?: string;
};

function trimField(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function chosenCapabilities(raw: unknown): CapabilityId[] {
  if (!Array.isArray(raw)) return [];
  const ids: CapabilityId[] = [];
  for (const id of raw) {
    if (typeof id === "string" && isCapabilityId(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function fallbackIntro(name: string, lang: "en" | "he"): string {
  return lang === "he" ? `היי, כאן ${name}. איך אפשר לעזור?` : `Hi, this is ${name}. How can I help?`;
}

export function buildKnowledgeMarkdown(profile: Omit<RapidExtract, "knowledgeMd">, source: string): string {
  const lines = [`# ${profile.name || "Business"}`, ""];
  if (profile.intro) lines.push(profile.intro, "");
  if (profile.phone) lines.push(`Phone: ${profile.phone}`);
  if (profile.venueAddress) lines.push(`Address: ${profile.venueAddress}`);
  if (profile.venueHours) lines.push(`Hours: ${profile.venueHours}`);
  lines.push("", "## About", "", source.trim().slice(0, MAX_CHARS));
  return lines.join("\n").trim();
}

export function withActivationNote(knowledgeMd: string): string {
  return `${knowledgeMd.trim()}\n\n${DEMO_ACTIVATION_NOTE}`.trim();
}

export function profileNeedsName(profile: { name?: string }): boolean {
  return !profile.name?.trim();
}

export function researchPrompt(name: string, website: string, pageText: string): string {
  const page = pageText.trim().slice(0, MAX_CHARS);
  const hebrew = looksHebrew(page || name);
  const lines = hebrew
    ? [
        `צור לי קובץ md לסוכן ai שמתאר את כל פרטי העסק שהסוכן צריך לדעת עבור העסק ${name.trim()} ${website.trim()}`,
        "כתוב את הקובץ בעברית. החזר רק את קובץ ה-markdown, בלי הקדמה.",
      ]
    : [
        `Write a markdown file for an AI agent that describes everything the agent needs to know about the business ${name.trim()} ${website.trim()}`,
        "Write the file in English. Return only the markdown file, with no introduction.",
      ];
  if (page) lines.push(hebrew ? `טקסט מהאתר:\n${page}` : `Text from the site:\n${page}`);
  return lines.join("\n\n");
}

export function researchRequest(name: string, website: string, pageText: string) {
  return {
    model: rapidDemoResearchModel(),
    input: researchPrompt(name, website, pageText),
    tools: [{ type: "url_context" as const }],
  };
}

type ResearchStep = {
  type: string;
  content?: Array<{ type?: string; text?: string }>;
};

export function markdownFromInteraction(interaction: {
  output_text?: string;
  steps?: ResearchStep[];
}): string | undefined {
  const direct = unwrapMarkdown(trimField(interaction.output_text));
  if (direct) return direct.slice(0, MAX_CHARS);
  const parts: string[] = [];
  for (const step of interaction.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const block of step.content ?? []) {
      const text = block.type === "text" ? unwrapMarkdown(trimField(block.text)) : undefined;
      if (text) parts.push(text);
    }
  }
  const joined = trimField(parts.join("\n\n"));
  return joined ? joined.slice(0, MAX_CHARS) : undefined;
}

function unwrapMarkdown(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return trimField(fenced?.[1] ?? text);
}

export function applyMissingName(profile: RapidExtract, name: string): RapidExtract {
  const named = name.trim();
  const intro = profile.intro || fallbackIntro(named, profile.chatLanguage === "en" ? "en" : "he");
  const next: RapidExtract = { ...profile, name: named, intro };
  if (!next.websiteUrl) {
    next.knowledgeMd = buildKnowledgeMarkdown(next, next.pageText || next.knowledgeMd);
  }
  return next;
}

export function normalizeRapidExtract(
  raw: OnboardExtract & {
    capabilities?: unknown;
    knowledgeMarkdown?: string;
    pageText?: string;
    websiteUrl?: string;
  },
  source: string,
): RapidExtract {
  const chatLanguage = raw.chatLanguage && isChatLanguage(raw.chatLanguage) ? raw.chatLanguage : "multi";
  const name = trimField(raw.name);
  const profile: Omit<RapidExtract, "knowledgeMd"> = {
    name,
    phone: trimField(raw.phone),
    intro: trimField(raw.intro),
    venueAddress: trimField(raw.venueAddress),
    venueHours: trimField(raw.venueHours),
    chatLanguage,
    capabilities: chosenCapabilities(raw.capabilities),
    pageText: source,
    websiteUrl: trimField(raw.websiteUrl),
  };
  if (!profile.intro && profile.name) {
    profile.intro = fallbackIntro(profile.name, chatLanguage === "en" ? "en" : "he");
  }
  const knowledgeMd = trimField(raw.knowledgeMarkdown) ?? buildKnowledgeMarkdown(profile, source);
  return { ...profile, knowledgeMd };
}

export function readStoredExtract(raw: unknown, sourceFallback = ""): RapidExtract {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pageText = typeof o.pageText === "string" && o.pageText.trim() ? o.pageText : sourceFallback;
  return normalizeRapidExtract(
    {
      name: typeof o.name === "string" ? o.name : undefined,
      phone: typeof o.phone === "string" ? o.phone : undefined,
      intro: typeof o.intro === "string" ? o.intro : undefined,
      venueAddress: typeof o.venueAddress === "string" ? o.venueAddress : undefined,
      venueHours: typeof o.venueHours === "string" ? o.venueHours : undefined,
      chatLanguage: typeof o.chatLanguage === "string" && isChatLanguage(o.chatLanguage) ? o.chatLanguage : undefined,
      capabilities: o.capabilities,
      knowledgeMarkdown: typeof o.knowledgeMd === "string" ? o.knowledgeMd : undefined,
      pageText,
      websiteUrl: typeof o.websiteUrl === "string" ? o.websiteUrl : undefined,
    },
    pageText,
  );
}

export async function researchBusinessMarkdown(opts: {
  name: string;
  website: string;
  pageText: string;
}): Promise<string | undefined> {
  const key = geminiApiKey();
  const page = parsePublicHttpsUrl(opts.website);
  if (!key || !opts.name.trim() || !page) return undefined;
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const interaction = await client.interactions.create(researchRequest(opts.name, page.href, opts.pageText));
    return markdownFromInteraction(interaction);
  } catch (err) {
    console.warn(JSON.stringify({ msg: "rapid_demo.research_failed", error: String(err) }));
    return undefined;
  }
}

/** Structured fields from the onboard extractor. Gemini writes the knowledge file only when the name and website are both known. */
export async function composeRapidProfile(opts: {
  source: string;
  capabilities: CapabilityId[];
  website?: string;
}): Promise<RapidExtract> {
  const source = opts.source.trim().slice(0, MAX_CHARS);
  const onboard = source ? await extractOnboardDetails(source) : {};
  const profile = normalizeRapidExtract(
    { ...onboard, capabilities: opts.capabilities, websiteUrl: opts.website },
    source,
  );
  if (!opts.website || !profile.name) return profile;
  const researched = await researchBusinessMarkdown({
    name: profile.name,
    website: opts.website,
    pageText: source,
  });
  return researched ? { ...profile, knowledgeMd: researched } : profile;
}
