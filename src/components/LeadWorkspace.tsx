"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { StaffChatComposer } from "@/components/ChatComposer";
import { ChatThread } from "@/components/ChatThread";
import { CapturedFieldsBlock } from "@/components/CapturedFieldsBlock";
import { LeadChatPoll } from "@/components/LeadChatPoll";
import { RequestsTable, type RequestTableRow } from "@/components/RequestsTable";
import type { RequestDecisionLabels } from "@/components/RequestDecisionForm";
import { DecisionsLogTable, type DecisionLogRow } from "@/components/DecisionsLogTable";
import {
  convoStatusLabel,
  intentLabel,
  stageLabel,
} from "@/lib/ui/labels";
import { formatPhoneDisplay } from "@/lib/leads";
import { normalizeLeadStatus, type UiCopy, type UiLang } from "@/lib/ui";
import type { FlowDefinition, LeadFields, LeadSchema } from "@/lib/flow/types";

type Message = { id: string; role: string; text: string; createdAt: string | Date };
type ConversationItem = {
  id: string;
  status: string;
  flowState: string;
  summary: string;
  updatedAt: string | Date;
  lastAt: string | Date;
  messageCount: number;
};

type Props = {
  lang: UiLang;
  ui: UiCopy;
  leadId: string;
  name: string;
  phone?: string;
  email?: string;
  intent?: string;
  status?: string;
  stage?: string;
  convoStatus?: string;
  isDemo?: boolean;
  channel: { provider: string; providerAccountId: string } | null | undefined;
  waitingHuman?: boolean;
  instagramUrl?: string;
  instagramHandle?: string;
  whatsappUrl?: string;
  whatsappLabel?: string;
  showOpenFullLead?: boolean;
  conversations: ConversationItem[];
  activeConversationId?: string;
  flow?: FlowDefinition;
  messages: Message[];
  summary?: string;
  composerFrom: string;
  composerDisabled: boolean;
  /** Latest conversation for this lead — end-conversation only shows then. */
  isLatestConversation?: boolean;
  /** True when the lead already has any non-closed conversation. */
  hasOpenConversation?: boolean;
  /** Newest conversation id (by activity) — requests from older threads cannot be decided. */
  latestConversationId?: string;
  conversationId?: string;
  schema: LeadSchema;
  fields: LeadFields;
  requests: RequestTableRow[];
  decisionLogs: DecisionLogRow[];
  requestLabels: RequestDecisionLabels;
  chatLabels: {
    placeholder: string;
    waitingHuman: string;
    send: string;
    sending: string;
    sendFailed: string;
  };
  threadLabels: {
    emptyThread: string;
    roles: Record<string, string>;
    today: string;
    yesterday: string;
  };
};

function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="ltr-isolate">
      {children}
    </span>
  );
}

export function LeadWorkspace(props: Props) {
  const [tab, setTab] = useState<"chat" | "decisions" | "meetings">("chat");
  const statusId = props.status ? normalizeLeadStatus(props.status) : undefined;
  const locale = props.lang === "he" ? "he-IL" : "en-GB";

  const decisionLogs = props.decisionLogs;
  const allRequests = props.requests;

  return (
    <div className="lead-page">
      <p className="lead-page-nav">
        <Link href="/leads">{props.ui.nav.leads}</Link>
        {" · "}
        <span>{props.name}</span>
      </p>

      <div className="lead-workspace">
        <div className="stack lead-sidebar">
          <div className="card lead-profile">
            <div className="lead-profile-header">
              <h2>{props.ui.demo.leadProfile}</h2>
              {props.isDemo ? (
                <span className="badge badge-demo">{props.ui.common.demo}</span>
              ) : null}
            </div>
            <p className="lead-profile-name">{props.name}</p>
            <div className="lead-profile-meta">
              <ChannelBadge lang={props.lang} channel={props.channel} />
              {statusId ? <span className="badge">{props.ui.status[statusId]}</span> : null}
              {props.stage ? (
                <span className="badge badge-warn">{stageLabel(props.ui, props.stage)}</span>
              ) : null}
              {props.convoStatus ? (
                <span className="muted">{convoStatusLabel(props.ui, props.convoStatus)}</span>
              ) : null}
            </div>
            <dl className="detail-list">
              {props.phone ? (
                <>
                  <dt>{props.ui.common.phone}</dt>
                  <dd>
                    <Ltr>{formatPhoneDisplay(props.phone)}</Ltr>
                  </dd>
                </>
              ) : null}
              {props.email ? (
                <>
                  <dt>{props.ui.common.email}</dt>
                  <dd>
                    <Ltr>{props.email}</Ltr>
                  </dd>
                </>
              ) : null}
              {props.channel?.provider === "whatsapp" && props.whatsappUrl ? (
                <>
                  <dt>{props.ui.common.whatsapp}</dt>
                  <dd>
                    <a href={props.whatsappUrl} target="_blank" rel="noopener noreferrer">
                      <Ltr>
                        {formatPhoneDisplay(props.whatsappLabel || props.phone) ||
                          props.ui.common.whatsapp}
                      </Ltr>
                    </a>
                  </dd>
                </>
              ) : null}
              {props.channel?.provider === "instagram" && props.instagramUrl ? (
                <>
                  <dt>{props.ui.common.instagramProfile}</dt>
                  <dd>
                    <a href={props.instagramUrl} target="_blank" rel="noopener noreferrer">
                      {props.instagramHandle
                        ? `@${props.instagramHandle}`
                        : props.ui.common.instagramProfile}
                    </a>
                  </dd>
                </>
              ) : null}
              {props.intent ? (
                <>
                  <dt>{props.ui.common.intent}</dt>
                  <dd>{intentLabel(props.ui, props.intent)}</dd>
                </>
              ) : null}
            </dl>

            <CapturedFieldsBlock
              ui={props.ui}
              leadId={props.leadId}
              schema={props.schema}
              fields={props.fields}
              status={props.status}
            />

            {props.waitingHuman ? (
              <div className="row-actions">
                <Link href="/inbox" className="btn-secondary">
                  {props.ui.nav.inbox}
                </Link>
              </div>
            ) : null}
          </div>

          <div className="card lead-convo-card">
            <div className="lead-convo-card-head">
              <h3>{props.ui.common.conversation}</h3>
              {props.conversationId && props.convoStatus !== "closed" ? (
                <form
                  action={`/api/leads/${props.leadId}/new-conversation`}
                  method="post"
                  className="lead-convo-end-form"
                >
                  <input type="hidden" name="intent" value="end" />
                  <input type="hidden" name="conversationId" value={props.conversationId} />
                  <button type="submit" className="btn-ghost">
                    {props.ui.inbox.newConversation}
                  </button>
                </form>
              ) : null}
            </div>
            <div className="stack">
              {props.conversations.map((c) => (
                <Link
                  key={c.id}
                  href={`/leads/${props.leadId}?c=${c.id}`}
                  className={`inbox-task-link${props.activeConversationId === c.id ? " active" : ""}`}
                >
                  <strong>
                    {new Date(c.lastAt).toLocaleString(locale, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                  <div className="muted">
                    {c.flowState === "done" ? props.ui.stages.done : c.status}
                    {c.summary ? ` · ${c.summary.slice(0, 80)}` : ""}
                    {c.messageCount ? ` · ${c.messageCount}` : ""}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="card chat-panel lead-main">
          <LeadChatPoll enabled={tab === "chat" && props.convoStatus !== "closed"} />
          <div className="lead-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "chat"}
              className={`lead-tab${tab === "chat" ? " active" : ""}`}
              onClick={() => setTab("chat")}
            >
              {props.ui.common.conversation}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "decisions"}
              className={`lead-tab${tab === "decisions" ? " active" : ""}`}
              onClick={() => setTab("decisions")}
            >
              {props.ui.common.decisionsTab}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "meetings"}
              className={`lead-tab${tab === "meetings" ? " active" : ""}`}
              onClick={() => setTab("meetings")}
            >
              {props.ui.common.meetingsTab}
            </button>
          </div>

          {tab === "chat" ? (
            <>
              {props.summary ? (
                <p className="muted lead-chat-summary" style={{ whiteSpace: "pre-wrap" }}>
                  {props.summary}
                </p>
              ) : null}
              <ChatThread
                lang={props.lang}
                messages={props.messages}
                labels={props.threadLabels}
                leadName={props.name}
              />
              {props.convoStatus === "closed" ? (
                <div className="composer lead-convo-ended" role="region" aria-label={props.ui.inbox.conversationEnded}>
                  <div className="lead-convo-ended-bar">
                    <span className="lead-convo-ended-pill">{props.ui.inbox.conversationEnded}</span>
                    {props.hasOpenConversation ? (
                      <span className="lead-convo-ended-hint">{props.ui.inbox.reopenDisabledHint}</span>
                    ) : null}
                  </div>
                  <div className="lead-convo-ended-actions" role="group">
                    <form action={`/api/leads/${props.leadId}/new-conversation`} method="post">
                      <input type="hidden" name="intent" value="reopen" />
                      {props.conversationId ? (
                        <input type="hidden" name="conversationId" value={props.conversationId} />
                      ) : null}
                      <button
                        type="submit"
                        className="btn lead-convo-ended-btn"
                        disabled={Boolean(props.hasOpenConversation)}
                        title={
                          props.hasOpenConversation
                            ? props.ui.inbox.reopenDisabledHint
                            : undefined
                        }
                      >
                        {props.ui.inbox.reopenConversation}
                      </button>
                    </form>
                    <form action={`/api/leads/${props.leadId}/new-conversation`} method="post">
                      <input type="hidden" name="intent" value="start" />
                      {props.conversationId ? (
                        <input type="hidden" name="conversationId" value={props.conversationId} />
                      ) : null}
                      <button
                        type="submit"
                        className="btn-secondary lead-convo-ended-btn"
                        disabled={Boolean(props.hasOpenConversation)}
                        title={
                          props.hasOpenConversation
                            ? props.ui.inbox.startDisabledHint
                            : undefined
                        }
                      >
                        {props.ui.inbox.startConversation}
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                <StaffChatComposer
                  leadId={props.leadId}
                  conversationId={props.conversationId ?? props.activeConversationId ?? ""}
                  disabled={props.composerDisabled}
                  labels={props.chatLabels}
                />
              )}
            </>
          ) : tab === "decisions" ? (
            <div className="lead-visits-panel">
              <DecisionsLogTable
                ui={props.ui}
                rows={decisionLogs}
                emptyLabel={props.ui.inbox.decisionLogEmpty}
                locale={locale}
              />
            </div>
          ) : (
            <div className="lead-visits-panel">
              <RequestsTable
                ui={props.ui}
                leadId={props.leadId}
                requests={allRequests}
                labels={props.requestLabels}
                emptyLabel={props.ui.common.noMeetings}
                allowDecide
                latestConversationId={props.latestConversationId}
                decisionsLockedHint={props.ui.inbox.decisionsLockedHint}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
