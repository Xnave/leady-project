"use client";

import { useState } from "react";
import { IntroFieldChips } from "@/components/IntroFieldChips";
import { RulesEditor } from "@/components/documents/RulesEditor";
import { loadRulesDocument, rulesIssueList } from "@/lib/documents/rules-form";
import type { RulesDocument } from "@/lib/documents/rules";
import type { InviteStats, InviteTemplateState } from "@/lib/documents/invite/run";
import type { UiCopy } from "@/lib/ui";

type Props = {
  ui: UiCopy;
  enabled: boolean;
  testPhones: string;
  unrecognizedIntro: string;
  maxRejectTries: number;
  rejectCooldownMinutes: number;
  rules: string;
  autoInvite: boolean;
  clientDisplayName: string;
  inviteStats: InviteStats;
  inviteTemplates: Record<"opener" | "reminder", InviteTemplateState>;
};

export function DocumentsSettingsForm(props: Props) {
  const copy = props.ui.documentsUi;
  const [enabled, setEnabled] = useState(props.enabled);
  const [rules, setRules] = useState<RulesDocument>(() => loadRulesDocument(props.rules));
  const rulesOk = rulesIssueList(rules).length === 0;
  const [testPhones, setTestPhones] = useState(props.testPhones);
  const [unrecognizedIntro, setUnrecognizedIntro] = useState(props.unrecognizedIntro);
  const [maxRejectTries, setMaxRejectTries] = useState(String(props.maxRejectTries));
  const [rejectCooldownMinutes, setRejectCooldownMinutes] = useState(String(props.rejectCooldownMinutes));
  const [autoInvite, setAutoInvite] = useState(props.autoInvite);
  const [clientDisplayName, setClientDisplayName] = useState(props.clientDisplayName);
  const invite = copy.invite;
  const notApproved = (["opener", "reminder"] as const).some((k) => props.inviteTemplates[k] !== "approved");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled,
          rules,
          testPhones,
          unrecognizedIntro,
          maxRejectTries,
          rejectCooldownMinutes,
          autoInvite,
          clientDisplayName,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? copy.failed);
      setMessage(copy.saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="stack">
      <label className="chip-toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {copy.enabled}
      </label>
      <p className="muted">{copy.keyOnSources}</p>
      <label>
        {copy.testPhones}
        <textarea rows={3} value={testPhones} onChange={(e) => setTestPhones(e.target.value)} />
      </label>
      <p className="muted">{copy.testPhonesHint}</p>
      <label>
        {copy.unrecognizedIntro}
        <textarea rows={3} value={unrecognizedIntro} onChange={(e) => setUnrecognizedIntro(e.target.value)} />
      </label>
      <IntroFieldChips
        onInsert={(token) => setUnrecognizedIntro((current) => `${current}${current ? " " : ""}${token}`)}
      />
      <p className="muted">{copy.unrecognizedIntroHint}</p>
      <label>
        {copy.maxRejectTries}
        <input
          type="number"
          min={1}
          max={20}
          value={maxRejectTries}
          onChange={(e) => setMaxRejectTries(e.target.value)}
        />
      </label>
      <p className="muted">{copy.maxRejectTriesHint}</p>
      <label>
        {copy.rejectCooldownMinutes}
        <input
          type="number"
          min={1}
          max={1440}
          value={rejectCooldownMinutes}
          onChange={(e) => setRejectCooldownMinutes(e.target.value)}
        />
      </label>
      <p className="muted">{copy.rejectCooldownMinutesHint}</p>
      <fieldset className="stack">
        <legend>{invite.title}</legend>
        <p className="muted">{invite.blurb}</p>
        <label className="chip-toggle">
          <input type="checkbox" checked={autoInvite} onChange={(e) => setAutoInvite(e.target.checked)} />
          {invite.toggle}
        </label>
        <p className="muted">{invite.toggleHint}</p>
        <label>
          {invite.displayName}
          <input
            type="text"
            maxLength={60}
            value={clientDisplayName}
            onChange={(e) => setClientDisplayName(e.target.value)}
          />
        </label>
        <p className="muted">{invite.displayNameHint}</p>
        {autoInvite && !clientDisplayName.trim() ? <p className="error">{invite.noNameWarning}</p> : null}
        <p>
          <b>{invite.templates}</b>
          {": "}
          {invite.opener} · {invite.status[props.inviteTemplates.opener]}
          {" · "}
          {invite.reminder} · {invite.status[props.inviteTemplates.reminder]}
        </p>
        {autoInvite && notApproved ? <p className="muted">{invite.notApprovedWarning}</p> : null}
        {testPhones.trim() ? <p className="muted">{invite.testModeNote}</p> : null}
        <p className="muted">
          {(["invited", "started", "waiting", "handedOff", "stopped"] as const)
            .map((k) => `${invite.stats[k]}: ${props.inviteStats[k]}`)
            .join(" · ")}
        </p>
      </fieldset>
      <p className="muted rules-hint">{copy.rulesHint}</p>
      <RulesEditor value={rules} onChange={setRules} copy={copy.editor} />
      <div className="wizard-footer">
        <button type="submit" className="btn" disabled={pending || !rulesOk} aria-busy={pending}>
          {props.ui.common.save}
        </button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
