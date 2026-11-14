/**
 * The two WhatsApp templates that invite a new client to send their mortgage
 * documents. UTILITY, Hebrew, two quick-reply buttons (start / stop). They are created on each
 * tenant's own WhatsApp account (the client hears from the advisor's number),
 * by `scripts/invite-templates.ts`. This file is the source of truth for the
 * text Meta reviews; changing a body means a new `_vN` name.
 */
import { sanitizeTemplateParam } from "@/lib/crm/digest";

export type InviteKind = "opener" | "reminder";

export type InviteTemplate = {
  kind: InviteKind;
  /** Meta template name: lowercase letters, digits, underscores. */
  name: string;
  language: "he";
  category: "UTILITY";
  /** {{1}} client first name, {{2}} the name shown to clients. Never starts or ends with a variable. */
  body: string;
  /** Quick replies, in order: start, then stop. A tap arrives as an inbound message. */
  buttons: [string, string];
  /** One example per variable, for Meta's reviewers. */
  example: string[];
};

const START_BUTTON = "בואו נתחיל";
/** Tapping it stops the invite (`isStopReply` matches it). No opt-out footer: this is a utility template. */
export const INVITE_STOP_BUTTON = "הסר";
const BUTTONS: [string, string] = [START_BUTTON, INVITE_STOP_BUTTON];
const EXAMPLE = ["דנה", "ליאור - לייבל משכנתאות"];

export const INVITE_TEMPLATES: Record<InviteKind, InviteTemplate> = {
  opener: {
    kind: "opener",
    name: "documents_invite_opener_v1",
    language: "he",
    category: "UTILITY",
    body: [
      "שלום {{1}} 👋",
      "כאן העוזר הדיגיטלי של {{2}}.",
      "כדי להתקדם עם המשכנתא נאסוף כאן",
      "בווטסאפ את המסמכים הדרושים.",
      "זה לוקח כמה דקות.",
    ].join("\n"),
    buttons: BUTTONS,
    example: EXAMPLE,
  },
  reminder: {
    kind: "reminder",
    name: "documents_invite_reminder_v1",
    language: "he",
    category: "UTILITY",
    body: [
      "היי {{1}}, מה שלומך? 😊",
      "רק מזכירים שאפשר לשלוח כאן",
      "את המסמכים למשכנתא במקום אחד,",
      "בקצב שלכם.",
      "צוות {{2}} כאן בשבילכם 💙",
    ].join("\n"),
    buttons: BUTTONS,
    example: EXAMPLE,
  },
};

export function inviteTemplateParams(firstName: string, displayName: string): string[] {
  return [sanitizeTemplateParam(firstName, 40), sanitizeTemplateParam(displayName, 60)];
}

/** The body as the client reads it, for the conversation history in the CRM. */
export function fillInviteBody(t: InviteTemplate, params: string[]): string {
  return t.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}

/** Body for Zernio's `POST /v1/whatsapp/templates`. */
export function inviteTemplateCreateBody(t: InviteTemplate, accountId: string) {
  return {
    accountId,
    name: t.name,
    category: t.category,
    language: t.language,
    components: [
      { type: "BODY", text: t.body, example: { body_text: [t.example] } },
      { type: "BUTTONS", buttons: t.buttons.map((text) => ({ type: "QUICK_REPLY", text })) },
    ] as Array<{ type: string; text?: string; example?: unknown; buttons?: unknown[] }>,
  };
}
