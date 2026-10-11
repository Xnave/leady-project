"use client";

import { StaffChatComposer } from "@/components/ChatComposer";
import { ChatThread } from "@/components/ChatThread";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import { Icon } from "./Icon";

/**
 * The Conversation tab: the shared WhatsApp-replica thread and the staff composer.
 * With the 24h window closed the composer becomes the closed-window note and a link
 * to the chat on the owner's phone. `chatLoading` is the instant-peek shell state.
 */
export function LeadChat({
  dto,
  ui,
  lang,
  onSent,
  chatLoading = false,
}: {
  dto: LeadViewDTO;
  ui: UiCopy;
  lang: "he" | "en";
  onSent: () => void;
  /** Lite view still in flight - show thread skeletons instead of an empty inbox. */
  chatLoading?: boolean;
}) {
  const conversationClosed = dto.conversationStatus === "closed";
  const windowClosed = dto.channel === "whatsapp" && dto.windowClosed;
  return (
    <div className="crm-lv-chat" aria-busy={chatLoading || undefined}>
      {chatLoading ? (
        <div className="crm-lv-chat-loading crm-skel-stack" aria-hidden="true">
          <span className="crm-skel w60" />
          <span className="crm-skel w80" />
          <span className="crm-skel w40" />
          <span className="crm-skel w80" />
        </div>
      ) : (
        <ChatThread
          lang={lang}
          messages={dto.messages}
          leadName={dto.name}
          labels={{ emptyThread: ui.chat.emptyThread, roles: ui.roles, today: ui.chat.today, yesterday: ui.chat.yesterday }}
        />
      )}
      {chatLoading ? (
        <div className="composer crm-composer-closed">
          <span className="crm-skel w60" aria-hidden="true" />
        </div>
      ) : conversationClosed ? (
        <div className="composer crm-composer-closed">
          <span>{ui.crm.conversationClosed}</span>
        </div>
      ) : windowClosed ? (
        <div className="composer crm-composer-closed">
          <span>{ui.crm.windowClosedNote}</span>
          {dto.waUrl ? (
            <a className="btn-secondary" href={dto.waUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="phone" small />
              {ui.crm.cta.coldPhone}
            </a>
          ) : null}
        </div>
      ) : (
        <StaffChatComposer
          leadId={dto.id}
          conversationId={dto.conversationId ?? undefined}
          labels={{
            placeholder: ui.inbox.staffPlaceholder,
            waitingHuman: ui.chat.waitingHuman,
            send: ui.common.send,
            sending: ui.common.sending,
            sendFailed: ui.chat.sendFailed,
          }}
          onSent={onSent}
        />
      )}
    </div>
  );
}
