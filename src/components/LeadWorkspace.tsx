"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { StaffChatComposer } from "@/components/ChatComposer";
import { ChatThread } from "@/components/ChatThread";
import { LeadChatPoll } from "@/components/LeadChatPoll";
import { LeadFieldsForm } from "@/components/LeadFieldsForm";
import { MeetingsTable } from "@/components/MeetingsTable";
import {
  convoStatusLabel,
  intentLabel,
  meetingKindLabel,
  stageLabel,
} from "@/lib/ui/labels";
import { formatPhoneDisplay } from "@/lib/leads";
import { isBookingSessionKey } from "@/lib/flow/booking";
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
type MeetingItem = {
  id: string;
  status: string;
  kind: string;
  slotText: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  needText: string | null;
  conversationId: string;
  awaitingCustomerConfirm?: boolean;
  customerConfirmed?: boolean;
};

const HIDDEN_CAPTURED = new Set([
  "instagramUsername",
  "zernioConversationId",
  "booking_confirm",
  "booking_flow",
  "booking",
  "staff_slot_offer",
  "time_preference",
  "name_collected_by_agent",
  "intent", // already shown in the profile block
  "meetingId",
]);

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
  /** Newest conversation id (by activity) — meetings from older threads cannot be decided. */
  latestConversationId?: string;
  conversationId?: string;
  schema: LeadSchema;
  fields: LeadFields;
  meetings: MeetingItem[];
  meetingLabels: {
    need: string;
    name: string;
    phone: string;
    email: string;
    approve: string;
    decline: string;
    reschedule: string;
    alternativeSlotLabel: string;
    alternativeSlotPlaceholder: string;
    visitDefault: string;
    noteLabel: string;
    notePlaceholder: string;
    customReplyLabel: string;
    customReplyPlaceholder: string;
    updateDecision: string;
    currentStatus: string;
    changeDecision: string;
    cancel?: string;
  };
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

function formatCapturedValue(
  key: string,
  value: unknown,
  ui: UiCopy,
): string {
  if (value == null || value === "") return "";
  if (key === "meetingId") return "";
  if (key === "intent" && typeof value === "string") {
    return intentLabel(ui, value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (key === "phone") return formatPhoneDisplay(String(value));
    return String(value);
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    // Never surface internal ids (meetingId, conversation ids, etc.).
    const statusRaw = typeof rec.status === "string" ? rec.status : "";
    const status =
      statusRaw === "pending"
        ? ui.common.pending
        : statusRaw === "approved"
          ? ui.meeting.approved
          : statusRaw === "rejected"
            ? ui.meeting.rejected
            : statusRaw;
    const when = typeof rec.when === "string" ? rec.when : "";
    const kindRaw = typeof rec.kind === "string" ? rec.kind.trim() : "";
    const kind =
      kindRaw && kindRaw !== "visit" ? meetingKindLabel(ui, kindRaw) : "";
    return [status, when, kind].filter(Boolean).join(" · ");
  }
  return "";
}

export function LeadWorkspace(props: Props) {
  const [tab, setTab] = useState<"chat" | "decisions" | "meetings">("chat");
  const [editingFields, setEditingFields] = useState(false);
  const statusId = props.status ? normalizeLeadStatus(props.status) : undefined;
  const locale = props.lang === "he" ? "he-IL" : "en-GB";

  const decisionMeetings = useMemo(
    () =>
      props.meetings.filter(
        (m) => m.status === "pending" || m.status === "rejected" || m.awaitingCustomerConfirm,
      ),
    [props.meetings],
  );
  const approvedMeetings = useMemo(
    () => props.meetings.filter((m) => m.status === "approved"),
    [props.meetings],
  );

  const capturedEntries = useMemo(() => {
    return Object.entries(props.fields)
      .filter(([key]) => !HIDDEN_CAPTURED.has(key) && !isBookingSessionKey(key))
      .map(([key, value]) => ({
        key,
        value: formatCapturedValue(key, value, props.ui),
        ltr: key === "phone" || key === "email",
      }))
      .filter((row) => row.value);
  }, [props.fields, props.ui]);

  const crmSchema: LeadSchema = useMemo(
    () => ({
      fields: Object.fromEntries(
        Object.entries(props.schema.fields).filter(([key]) => !isBookingSessionKey(key)),
      ),
    }),
    [props.schema],
  );
  const crmFields: LeadFields = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(props.fields).filter(([key]) => !isBookingSessionKey(key)),
      ),
    [props.fields],
  );

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

            <div className="lead-captured-block">
              <div className="row-actions" style={{ justifyContent: "space-between" }}>
                <h3 className="lead-subhead">{props.ui.common.captured}</h3>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setEditingFields((v) => !v)}
                >
                  {editingFields ? props.ui.common.done : props.ui.common.editDetails}
                </button>
              </div>
              {editingFields ? (
                <LeadFieldsForm
                  ui={props.ui}
                  action={`/api/leads/${props.leadId}/fields`}
                  schema={crmSchema}
                  fields={crmFields}
                  status={props.status}
                  statusLabels={props.ui.status}
                  statusLegend={props.ui.common.status}
                  saveLabel={props.ui.common.save}
                  enumLabels={{ intent: props.ui.intents }}
                />
              ) : capturedEntries.length > 0 ? (
                <dl className="detail-list">
                  {capturedEntries.map((row) => (
                    <div key={row.key} className="detail-row">
                      <dt>{props.ui.leadFields[row.key] ?? row.key}</dt>
                      <dd>{row.ltr ? <Ltr>{row.value}</Ltr> : row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted">{props.ui.common.empty}</p>
              )}
            </div>

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
              {props.conversationId ? (
                props.convoStatus !== "closed" ? (
                  props.isLatestConversation ? (
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
                  ) : null
                ) : (
                  <div className="lead-convo-actions" role="group" aria-label={props.ui.inbox.conversationEnded}>
                    <form action={`/api/leads/${props.leadId}/new-conversation`} method="post">
                      <input type="hidden" name="intent" value="reopen" />
                      <input type="hidden" name="conversationId" value={props.conversationId} />
                      <button
                        type="submit"
                        className="btn-secondary"
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
                      <input type="hidden" name="conversationId" value={props.conversationId} />
                      <button
                        type="submit"
                        className="btn-secondary"
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
                )
              ) : null}
            </div>
            {props.convoStatus === "closed" ? (
              <p className="lead-convo-ended-label">{props.ui.inbox.conversationEnded}</p>
            ) : null}
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
          <LeadChatPoll enabled={tab === "chat"} />
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
              {decisionMeetings.length ? ` (${decisionMeetings.length})` : ""}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "meetings"}
              className={`lead-tab${tab === "meetings" ? " active" : ""}`}
              onClick={() => setTab("meetings")}
            >
              {props.ui.common.meetingsTab}
              {approvedMeetings.length ? ` (${approvedMeetings.length})` : ""}
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
                <div className="composer lead-convo-ended">
                  <p className="lead-convo-ended-label">{props.ui.inbox.conversationEnded}</p>
                  <div className="lead-convo-actions" role="group">
                    <form action={`/api/leads/${props.leadId}/new-conversation`} method="post">
                      <input type="hidden" name="intent" value="reopen" />
                      {props.conversationId ? (
                        <input type="hidden" name="conversationId" value={props.conversationId} />
                      ) : null}
                      <button
                        type="submit"
                        className="btn"
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
                        className="btn-secondary"
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
              <MeetingsTable
                ui={props.ui}
                leadId={props.leadId}
                meetings={decisionMeetings}
                labels={props.meetingLabels}
                emptyLabel={props.ui.common.noDecisions}
                allowDecide
                latestConversationId={props.latestConversationId}
                decisionsLockedHint={props.ui.inbox.decisionsLockedHint}
              />
            </div>
          ) : (
            <div className="lead-visits-panel">
              <MeetingsTable
                ui={props.ui}
                leadId={props.leadId}
                meetings={approvedMeetings}
                labels={props.meetingLabels}
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
