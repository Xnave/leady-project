import type { BuiltinPresetId } from "./presets";

export type SampleId = "pricing" | "vague" | "complaint";

export const PREVIEW_SAMPLES: Record<"en" | "he", { id: SampleId; customer: string }[]> = {
  en: [
    { id: "pricing", customer: "How much does it cost?" },
    { id: "vague", customer: "hi, interested" },
    { id: "complaint", customer: "I've been waiting a week for someone to call me back. Not happy." },
  ],
  he: [
    { id: "pricing", customer: "כמה זה עולה?" },
    { id: "vague", customer: "היי, מעוניין" },
    { id: "complaint", customer: "אני מחכה כבר שבוע שיחזרו אליי. ממש לא נעים." },
  ],
};

/** Static sample replies for preset cards (no LLM), so presets differ visibly before a live preview. */
export const PRESET_SAMPLE_REPLY: Record<"en" | "he", Record<BuiltinPresetId, string>> = {
  en: {
    warm_concierge:
      "Happy to help! Prices depend on the size and finish — want me to set up a quick call so we can give you an exact quote?",
    precise_short: "Depends on size and finish. Want an exact quote?",
    premium_formal:
      "Thank you for reaching out. Pricing depends on the dimensions and finish you choose; we would be glad to prepare a personal quote.",
    upbeat_sales:
      "Great timing — we have some beautiful options right now ✨ Price depends on size and finish. Shall we book a quick call for an exact quote?",
  },
  he: {
    warm_concierge: "בשמחה! המחיר תלוי בגודל ובגימור — רוצה שנקבע שיחה קצרה ונחזור עם הצעה מדויקת?",
    precise_short: "תלוי בגודל ובגימור. לשלוח הצעה מדויקת?",
    premium_formal: "תודה על הפנייה. המחיר נקבע לפי המידות והגימור שתבחרו; נשמח להכין עבורכם הצעה אישית.",
    upbeat_sales: "תזמון מעולה — יש לנו עכשיו אפשרויות מהממות ✨ המחיר תלוי בגודל ובגימור. נקבע שיחה קצרה להצעה מדויקת?",
  },
};
