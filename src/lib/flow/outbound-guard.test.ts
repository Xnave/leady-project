import { describe, expect, it } from "vitest";
import { bookingActiveGapReply } from "./capabilities/booking";
import { flowForCapabilities } from "./catalog";
import { bookingInstance } from "./booking-config";
import { outboundReply, sanitizeModelOutbound } from "./outbound-guard";
import type { TurnContext } from "./types";
import { defaultHitlPolicy, defaultLeadSchema } from "./validate";

const CAL = "https://cal.com/wave-ai-automations/define-your-business-solution";

function ctx(opts: { fields?: Record<string, unknown>; knowledge?: string }): TurnContext {
  const flow = flowForCapabilities({ capabilities: ["booking"] });
  return {
    tenantId: "t1",
    tenant: {
      name: "Zapidly",
      phone: "",
      intro: "We help.",
      chatLanguage: "he",
      capabilityInstances: [bookingInstance({ venueHours: "א-ה 9-19", venueAddress: "1 Main" })],
    },
    agent: {
      id: "a1",
      tenantId: "t1",
      catalogId: "inbox",
      systemPrompt: "BASE",
      knowledgeText: opts.knowledge ?? "",
      flow,
      flowVersion: 1,
      leadSchema: defaultLeadSchema,
      hitlPolicy: defaultHitlPolicy,
    },
    conversation: {
      id: "c1",
      status: "open",
      flowState: "talk",
      flowVersion: 1,
      nudgeCountByStage: {},
    },
    lead: { id: "l1", externalUserId: "972523434400", fields: opts.fields ?? {} },
    messages: [{ role: "lead", text: "מחר" }],
    channel: { provider: "whatsapp", customerPhone: "972523434400" },
  };
}

describe("sanitizeModelOutbound", () => {
  it("replaces a saved-visit claim and a calendar offer with the open booking question", () => {
    const turn = ctx({ fields: { booking_flow: "active" } });
    const out = sanitizeModelOutbound(
      "רשמתי את הבקשה לדמו. תרצה קישור ליומן שלנו?",
      turn,
    );
    expect(out).toBe(bookingActiveGapReply(turn));
    expect(out).not.toMatch(/יומן|נרשמ/);
  });

  it("replaces the lead's own number while booking is open", () => {
    const turn = ctx({ fields: { booking_flow: "active" } });
    const out = sanitizeModelOutbound("אפשר להתקשר אלינו ב-052-343-4400", turn);
    expect(out).toBe(bookingActiveGapReply(turn));
    expect(out).not.toMatch(/052/);
  });

  it("keeps a URL that is the exact knowledge string", () => {
    const turn = ctx({ knowledge: `קביעת פגישה: ${CAL}` });
    const text = `הנה הקישור: ${CAL}`;
    expect(sanitizeModelOutbound(text, turn)).toBe(text);
  });

  it("drops an unknown phone when booking is not open", () => {
    const turn = ctx({});
    expect(sanitizeModelOutbound("נשמח לעזור. תתקשר ל-052-343-4400.", turn)).toBe("נשמח לעזור.");
  });

  it("sends nothing new when the whole message is cleared and booking has no open gap", () => {
    const turn = ctx({});
    turn.messages = [
      { role: "agent", text: "איזה יום ושעה יתאימו לך לפגישה?" },
      { role: "lead", text: "מחר" },
    ];
    expect(outboundReply("רשמתי את הבקשה לדמו", turn)).toBe("");
  });
});
