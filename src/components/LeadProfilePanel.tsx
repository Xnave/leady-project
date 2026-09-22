import Link from "next/link";
import { CapturedFieldsBlock } from "@/components/CapturedFieldsBlock";
import { ChannelBadge } from "@/components/ChannelBadge";
import {
  convoStatusLabel,
  intentLabel,
  stageLabel,
} from "@/lib/ui/labels";
import { normalizeLeadStatus, type UiCopy, type UiLang } from "@/lib/ui";
import type { LeadFields, LeadSchema } from "@/lib/flow/types";

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
  showOpenFullLead?: boolean;
  /** When set, shows the same captured-data block as the lead detail page. */
  schema?: LeadSchema;
  fields?: LeadFields;
  conversationId?: string;
};

export function LeadProfilePanel({
  lang,
  ui,
  leadId,
  name,
  phone,
  email,
  intent,
  status,
  stage,
  convoStatus,
  isDemo,
  channel,
  waitingHuman,
  instagramUrl,
  instagramHandle,
  whatsappUrl,
  showOpenFullLead = true,
  schema,
  fields,
  conversationId,
}: Props) {
  const statusId = status ? normalizeLeadStatus(status) : undefined;
  const leadHref = conversationId
    ? `/leads/${leadId}?c=${conversationId}`
    : `/leads/${leadId}`;

  return (
    <div className="card lead-profile">
      <div className="lead-profile-header">
        <h2>{ui.demo.leadProfile}</h2>
        {isDemo ? <span className="badge badge-demo">{ui.common.demo}</span> : null}
      </div>
      <p className="lead-profile-name">{name}</p>
      <div className="lead-profile-meta">
        <ChannelBadge lang={lang} channel={channel} />
        {statusId ? (
          <span className="badge">{ui.status[statusId]}</span>
        ) : null}
        {stage ? (
          <span className="badge badge-warn">{stageLabel(ui, stage)}</span>
        ) : null}
        {convoStatus ? (
          <span className="muted">{convoStatusLabel(ui, convoStatus)}</span>
        ) : null}
      </div>
      <dl className="detail-list">
        {phone ? (
          <>
            <dt>{ui.common.phone}</dt>
            <dd>
              <span dir="ltr" className="ltr-isolate">
                {phone}
              </span>
            </dd>
          </>
        ) : null}
        {email ? (
          <>
            <dt>{ui.common.email}</dt>
            <dd>
              <span dir="ltr" className="ltr-isolate">
                {email}
              </span>
            </dd>
          </>
        ) : null}
        {channel?.provider === "whatsapp" && whatsappUrl ? (
          <>
            <dt>{ui.common.whatsapp}</dt>
            <dd>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <span dir="ltr" className="ltr-isolate">
                  {phone || ui.common.whatsapp}
                </span>
              </a>
            </dd>
          </>
        ) : null}
        {channel?.provider === "instagram" && instagramUrl ? (
          <>
            <dt>{ui.common.instagramProfile}</dt>
            <dd>
              <a href={instagramUrl} target="_blank" rel="noopener noreferrer">
                {instagramHandle ? `@${instagramHandle}` : ui.common.instagramProfile}
              </a>
            </dd>
          </>
        ) : null}
        {intent ? (
          <>
            <dt>{ui.common.intent}</dt>
            <dd>{intentLabel(ui, intent)}</dd>
          </>
        ) : null}
      </dl>
      {schema && fields ? (
        <CapturedFieldsBlock
          ui={ui}
          leadId={leadId}
          schema={schema}
          fields={fields}
          status={status}
        />
      ) : null}
      <div className="row-actions">
        {showOpenFullLead ? (
          <Link href={leadHref} className="btn-secondary">
            {ui.common.openLead}
          </Link>
        ) : null}
        {waitingHuman ? (
          <Link href="/inbox" className="btn-secondary">
            {ui.nav.inbox}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
