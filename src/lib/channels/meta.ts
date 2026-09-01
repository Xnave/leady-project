export type InboundMessage = {
  id: string;
  from: string;
  text: string;
  timestamp?: string;
};

export type MetaWebhook = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string };
        messages?: Array<{
          from: string;
          id: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
    messaging?: Array<{
      sender?: { id: string };
      message?: { mid?: string; text?: string };
    }>;
  }>;
};

export function extractChannelIds(payload: MetaWebhook): {
  phoneNumberId?: string;
  instagramAccountId?: string;
} {
  const change = payload.entry?.[0]?.changes?.[0]?.value;
  const phoneNumberId = change?.metadata?.phone_number_id;
  if (phoneNumberId) return { phoneNumberId };
  if (payload.object === "instagram") {
    return { instagramAccountId: payload.entry?.[0]?.id };
  }
  return {};
}

export function extractInboundMessages(payload: MetaWebhook): InboundMessage[] {
  const fromChanges =
    payload.entry?.flatMap((entry) =>
      (entry.changes ?? []).flatMap((change) =>
        (change.value?.messages ?? [])
          .filter((m) => m.type === "text" || m.text?.body)
          .map((m) => ({
            id: m.id,
            from: m.from,
            text: m.text?.body ?? "",
            timestamp: m.timestamp,
          })),
      ),
    ) ?? [];
  if (fromChanges.length) return fromChanges;

  return (
    payload.entry?.flatMap((entry) =>
      (entry.messaging ?? [])
        .filter((m) => m.message?.text)
        .map((m) => ({
          id: m.message?.mid ?? `${m.sender?.id}-${m.message?.text}`,
          from: m.sender?.id ?? "",
          text: m.message?.text ?? "",
        })),
    ) ?? []
  );
}

export async function sendOnChannel(opts: {
  apiBase: string;
  accessToken: string;
  provider: string;
  providerAccountId: string;
  to: string;
  text: string;
  zernioAccountId?: string;
  zernioConversationId?: string;
}): Promise<void> {
  if (opts.to.startsWith("demo-")) return;

  const zernio =
    opts.apiBase.includes("zernio.com") || Boolean(opts.zernioAccountId && opts.zernioConversationId);
  if (zernio) {
    if (!opts.zernioAccountId || opts.zernioAccountId === "zernio-sandbox" || !opts.zernioConversationId) {
      console.error("zernio send skipped: missing account or conversation id");
      return;
    }
    const { sendZernioInboxMessage } = await import("@/lib/zernio");
    try {
      await sendZernioInboxMessage({
        accountId: opts.zernioAccountId,
        conversationId: opts.zernioConversationId,
        text: opts.text,
      });
    } catch (err) {
      console.error("zernio send failed", err);
    }
    return;
  }

  if (!opts.accessToken.startsWith("hmat_")) return;

  const url = `${opts.apiBase.replace(/\/$/, "")}/v22.0/${opts.providerAccountId}/messages`;
  const body =
    opts.provider === "instagram"
      ? { recipient: { id: opts.to }, message: { text: opts.text } }
      : {
          messaging_product: "whatsapp",
          to: opts.to,
          type: "text",
          text: { body: opts.text },
        };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("channel send failed", res.status, await res.text());
  }
}

