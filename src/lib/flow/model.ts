import fs from "node:fs";
import path from "node:path";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * Next.js inlines `process.env.OPENAI_API_KEY` at compile time (often empty).
 * Always read/write with bracket access, and hydrate from `.env` on disk.
 */
function hydrateFromDotenvFile() {
  const file = path.join(process.cwd(), ".env");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    if (
      key === "OPENAI_API_KEY" ||
      key === "OPENAI_CHAT_MODEL" ||
      key === "GEMINI_API_KEY" ||
      key === "GOOGLE_GENERATIVE_AI_API_KEY" ||
      key === "ANTHROPIC_API_KEY"
    ) {
      process.env[key] = value;
    }
  }
}

function env(name: string): string {
  hydrateFromDotenvFile();
  return (process.env[name] ?? "").trim();
}

export function llmConfigured(): boolean {
  return Boolean(env("OPENAI_API_KEY") || env("GEMINI_API_KEY") || env("GOOGLE_GENERATIVE_AI_API_KEY") || env("ANTHROPIC_API_KEY"));
}

function openaiModelId(): string {
  return env("OPENAI_CHAT_MODEL") || "gpt-4o-mini";
}

/** OpenAI (OPENAI_API_KEY + optional OPENAI_CHAT_MODEL), then Gemini, then Anthropic. */
export function chatModel(): LanguageModel {
  const key = env("OPENAI_API_KEY");
  if (key) {
    process.env["OPENAI_API_KEY"] = key;
    return openai(openaiModelId());
  }
  const gemini = env("GOOGLE_GENERATIVE_AI_API_KEY") || env("GEMINI_API_KEY");
  if (gemini) {
    process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = gemini;
    return google("gemini-2.0-flash");
  }
  const anth = env("ANTHROPIC_API_KEY");
  if (anth) {
    process.env["ANTHROPIC_API_KEY"] = anth;
    return anthropic("claude-sonnet-4-5");
  }
  throw new Error("No LLM API key");
}
