"use client";

import { useState, type FormEvent } from "react";
import type { OpenTaskDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import { relTime, type Clock } from "./format";
import { Icon } from "./Icon";

type Decision = "approve" | "reschedule" | "decline";
type HandoffChoice = "bot" | "direct" | "return";
type Result = Promise<string | null>;

type ReturnFile = { id: string; label: string; slotIds: string[] };

/**
 * The open task, acted on in place (this replaced the Inbox for CRM tenants).
 * Approval: pick approve / offer another time / decline, optionally add a note, send.
 * Handoff: guide the bot (it writes the reply) or reply to the customer yourself (sent
 * as written; the bot waits for the customer's next message).
 * Waiting on the customer: status only. The send button is the view's one primary action.
 */
export function TaskCard({
  task,
  ui,
  lang,
  clock,
  onDecide,
  onComplete,
  documents,
}: {
  task: OpenTaskDTO;
  ui: UiCopy;
  lang: "he" | "en";
  clock: Clock | null;
  onDecide: (requestId: string, form: FormData) => Result;
  onComplete: (taskId: string, form: FormData) => Result;
  /** Uploaded checklist rows, when this task is the document review. */
  documents?: ReturnFile[];
}) {
  const t = ui.crm.task;
  const [mode, setMode] = useState<Decision>("approve");
  // Handoff: guide the bot, answer the customer, or send specific files back.
  const [choice, setChoice] = useState<HandoffChoice>("bot");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const age = clock ? relTime(task.createdAt, lang, clock.now) : "";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (choice === "return") {
      const selected = (documents ?? []).filter((file) => picked[file.id]);
      const missing = selected.some((file) => !String(form.get(`returnNote__${file.slotIds.join("|")}`) ?? "").trim());
      if (!selected.length || missing) {
        setError(ui.documentsUi.returnNeedOne);
        return;
      }
    }
    setBusy(true);
    setError(null);
    const err =
      task.kind === "approval" && task.request
        ? await onDecide(task.request.id, form)
        : await onComplete(task.id, form);
    setBusy(false);
    if (err) setError(t.failed);
  };

  if (task.awaitingCustomer) {
    return (
      <div className="crm-task crm-task-wait" role="region" aria-label={t.awaitingCustomer}>
        <div className="crm-task-h">
          <Icon name="clock" small />
          <b>{t.awaitingCustomer}</b>
        </div>
        {task.request ? <p className="crm-task-what">{[task.request.headline, task.request.timeText].filter(Boolean).join(" · ")}</p> : null}
        <p className="crm-task-muted">{t.awaitingHint}</p>
      </div>
    );
  }

  if (task.kind === "approval" && task.request) {
    const r = task.request;
    return (
      <form
        className="crm-task"
        onSubmit={submit}
        aria-label={ui.crm.reasonsLong.approval}
        // No-JS / pre-hydration fallback: a real POST (never a GET that puts text in the URL).
        action={`/api/requests/${r.id}/decide`}
        method="post"
      >
        <input type="hidden" name="decision" value={mode} />
        <input type="hidden" name="redirect" value="/leads?tab=needs" />
        <div className="crm-task-h">
          <Icon name="clock" small />
          <b>{ui.crm.reasonsLong.approval}</b>
          {age ? <span className="crm-task-muted">· {age}</span> : null}
        </div>
        <p className="crm-task-what">{[r.headline, r.timeText].filter(Boolean).join(" · ")}</p>
        {r.lines.length ? (
          <dl className="crm-task-lines">
            {r.lines.map((l) => (
              <div key={`${l.label}:${l.value}`}>
                <dt>{l.label}</dt>
                <dd>{l.ltr ? <bdi dir="ltr">{l.value}</bdi> : l.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="crm-presets" role="group">
          {(["approve", "reschedule", "decline"] as const).map((m) => (
            <button key={m} type="button" className="crm-btn-quiet crm-choice" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t[m]}
            </button>
          ))}
        </div>
        {mode === "reschedule" && r.timeShape === "point" ? (
          <label className="crm-task-field">
            <span>{t.altSlot}</span>
            <input name="alternativeSlot" required placeholder={t.altSlotPlaceholder} dir="auto" />
          </label>
        ) : null}
        {mode === "reschedule" && r.timeShape === "span" ? (
          <div className="crm-task-two">
            <label className="crm-task-field">
              <span>{t.altStart}</span>
              <input name="alternativeCheckIn" type="date" required />
            </label>
            <label className="crm-task-field">
              <span>{t.altEnd}</span>
              <input name="alternativeCheckOut" type="date" required />
            </label>
          </div>
        ) : null}
        <label className="crm-task-field">
          <span>{t.note}</span>
          <textarea name="note" rows={2} placeholder={t.notePlaceholder} />
        </label>
        {error ? <p className="crm-task-error" role="alert">{error}</p> : null}
        <div className="crm-task-foot">
          <button type="submit" className="btn" disabled={busy} aria-busy={busy}>
            {t[mode]}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="crm-task"
      onSubmit={submit}
      aria-label={ui.crm.reasonsLong.handoff}
      // No-JS / pre-hydration fallback: a real POST (never a GET that puts text in the URL).
      action={`/api/hitl/${task.id}/complete`}
      method="post"
    >
      <input type="hidden" name="approved" value={choice === "return" ? "no" : "yes"} />
      <input type="hidden" name="mode" value={choice === "return" ? "return_files" : choice === "direct" ? "direct" : "bot"} />
      <div className="crm-task-h">
        <Icon name="hand" small />
        <b>{ui.crm.reasonsLong.handoff}</b>
        {age ? <span className="crm-task-muted">· {age}</span> : null}
      </div>
      {task.reason ? <p className="crm-task-what">{task.reason}</p> : null}
      {task.summary ? (
        <div className="crm-task-summary">
          <span>{t.botSummary}</span>
          <p>{task.summary}</p>
        </div>
      ) : null}
      <div className="crm-presets" role="group">
        <button type="button" className="crm-btn-quiet crm-choice" aria-pressed={choice === "bot"} onClick={() => setChoice("bot")}>
          {t.modeBot}
        </button>
        <button type="button" className="crm-btn-quiet crm-choice" aria-pressed={choice === "direct"} onClick={() => setChoice("direct")}>
          {t.modeDirect}
        </button>
        {task.code === "document_checklist_complete" && documents?.length ? (
          <button type="button" className="crm-btn-quiet crm-choice" aria-pressed={choice === "return"} onClick={() => setChoice("return")}>
            {ui.documentsUi.returnFiles}
          </button>
        ) : null}
      </div>
      {choice === "return" && documents?.length ? (
        <>
          <p className="crm-task-muted">{ui.documentsUi.returnFilesHint}</p>
          <ul className="crm-doc-return">
            {documents.map((file) => {
              const group = file.slotIds.join("|");
              const on = Boolean(picked[file.id]);
              return (
                <li key={file.id}>
                  <label className="crm-doc-return-pick">
                    <input
                      type="checkbox"
                      name="returnGroup"
                      value={group}
                      checked={on}
                      onChange={(event) => setPicked((current) => ({ ...current, [file.id]: event.target.checked }))}
                    />
                    <bdi>{file.label}</bdi>
                  </label>
                  {on ? (
                    <label className="crm-task-field">
                      <span>{ui.documentsUi.returnNote}</span>
                      <textarea name={`returnNote__${group}`} rows={2} required placeholder={ui.documentsUi.returnNotePlaceholder} />
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <label className="crm-task-field">
            <span>{choice === "direct" ? t.direct : t.guide}</span>
            <textarea name="note" rows={3} required placeholder={choice === "direct" ? t.directPlaceholder : t.guidePlaceholder} />
          </label>
          <p className="crm-task-muted">{choice === "direct" ? t.directHint : t.guideHint}</p>
        </>
      )}
      {error ? <p className="crm-task-error" role="alert">{error}</p> : null}
      <div className="crm-task-foot">
        <button type="submit" className="btn" disabled={busy} aria-busy={busy}>
          {choice === "return" ? ui.documentsUi.returnSend : choice === "direct" ? t.sendToCustomer : t.sendToBot}
        </button>
      </div>
    </form>
  );
}
