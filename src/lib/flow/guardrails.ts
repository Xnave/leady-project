import { copyFor } from "@/lib/copy";

export function talkGuardrails(opts: {
  allowBook: boolean;
  requiredForBook: string[];
  hours: string;
  whatsappPhone?: string;
  lang: "en" | "he";
  /** Missing stance is passive: suggest a meeting only when it fits, not on every reply. */
  bookingStance?: "passive" | "proactive";
}): string {
  return copyFor(opts.lang).prompts.talkGuardrails({
    allowBook: opts.allowBook,
    fields: opts.requiredForBook.join(", "),
    hours: opts.hours,
    whatsappPhone: opts.whatsappPhone ?? "",
    bookingStance: opts.bookingStance,
  });
}
