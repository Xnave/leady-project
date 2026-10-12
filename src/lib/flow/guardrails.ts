import { copyFor } from "@/lib/copy";

export function talkGuardrails(opts: {
  allowBook: boolean;
  requiredForBook: string[];
  hours: string;
  whatsappPhone?: string;
  lang: "en" | "he";
}): string {
  return copyFor(opts.lang).prompts.talkGuardrails({
    allowBook: opts.allowBook,
    fields: opts.requiredForBook.join(", "),
    hours: opts.hours,
    whatsappPhone: opts.whatsappPhone ?? "",
  });
}
