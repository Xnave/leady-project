import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { FlowBreadcrumb } from "@/components/FlowBreadcrumb";
import type { FlowDefinition } from "@/lib/flow/types";
import {
  convoStatusLabel,
  intentLabel,
  stageLabel,
} from "@/lib/ui/labels";
import { normalizeLeadStatus, type UiCopy, type UiLang } from "@/lib/ui";

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
  flow?: FlowDefinition;
  waitingHuman?: boolean;
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
  flow,
  waitingHuman,
}: Props) {
  const statusId = status ? normalizeLeadStatus(status) : undefined;

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
      {flow && stage ? (
        <div className="lead-profile-flow">
          <p className="muted">{ui.flow.currentStage}</p>
          <FlowBreadcrumb flow={flow} current={stage} ui={ui} />
        </div>
      ) : null}
      <dl className="detail-list">
        {phone ? (
          <>
            <dt>{ui.common.phone}</dt>
            <dd>{phone}</dd>
          </>
        ) : null}
        {email ? (
          <>
            <dt>{ui.common.email}</dt>
            <dd>{email}</dd>
          </>
        ) : null}
        {intent ? (
          <>
            <dt>{ui.common.intent}</dt>
            <dd>{intentLabel(ui, intent)}</dd>
          </>
        ) : null}
      </dl>
      <div className="row-actions">
        <Link href={`/leads/${leadId}`} className="btn-secondary">
          {ui.demo.openFullLead}
        </Link>
        {waitingHuman ? (
          <Link href="/inbox" className="btn-secondary">
            {ui.nav.inbox}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
