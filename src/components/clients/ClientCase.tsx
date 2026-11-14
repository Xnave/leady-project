"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/crm/Icon";
import { LeadChat } from "@/components/crm/LeadChat";
import { crmApi } from "@/components/crm/crm-client";
import { absTime, initials, relTime } from "@/components/crm/format";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { CaseDocRow, CaseWave, ClientCaseDTO } from "@/lib/documents/clients-view";
import { fillUi, type UiCopy, type UiLang } from "@/lib/ui";

type Viewer = { files: { href: string; mime: string; label: string }[]; index: number };

async function post(url: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function reasonText(reason: string, ui: UiCopy): string {
  if (!reason) return "";
  return ui.documentsUi.reasons[reason as keyof typeof ui.documentsUi.reasons] ?? reason;
}

/* ---------------------------------------------------------------- viewer */

function FileViewer({ viewer, onClose, onStep, ui }: {
  viewer: Viewer;
  onClose: () => void;
  onStep: (delta: number) => void;
  ui: UiCopy;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const current = viewer.files[viewer.index];
  const handlers = useRef({ onClose, onStep });
  handlers.current = { onClose, onStep };
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    function onKey(event: KeyboardEvent) {
      const rtl = getComputedStyle(document.documentElement).direction === "rtl";
      if (event.key === "Escape") handlers.current.onClose();
      if (event.key === "ArrowLeft") handlers.current.onStep(rtl ? 1 : -1);
      if (event.key === "ArrowRight") handlers.current.onStep(rtl ? -1 : 1);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  if (!current) return null;
  const many = viewer.files.length > 1;
  return createPortal(
    <div
      ref={ref}
      className="crm-doc-preview"
      role="dialog"
      aria-modal="true"
      aria-label={current.label}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest("button, a, iframe")) return;
        swipe.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(event.clientY - start.y)) return;
        onStep(dx < 0 ? 1 : -1);
      }}
    >
      <button type="button" className="crm-doc-preview-scrim" aria-label={ui.clientsUi.detail.close} onClick={onClose} />
      <div className={`crm-doc-preview-card${many ? " has-nav" : ""}`}>
        <header>
          <bdi>{current.label}</bdi>
          {many ? (
            <span className="muted">{fillUi(ui.clientsUi.detail.fileOf, { n: viewer.index + 1, total: viewer.files.length })}</span>
          ) : null}
          <button type="button" className="crm-btn-quiet" onClick={onClose}>{ui.clientsUi.detail.close}</button>
        </header>
        {many ? (
          <button type="button" className="crm-doc-arrow" aria-label={ui.documentsUi.previousFile} disabled={viewer.index === 0} onClick={() => onStep(-1)}>‹</button>
        ) : null}
        <div className="crm-doc-preview-view">
          {current.mime.startsWith("image/") ? (
            // The operator opened this stored client document.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.href} alt={current.label} />
          ) : (
            <iframe title={current.label} src={`${current.href}#navpanes=0&zoom=page-width`} />
          )}
        </div>
        {many ? (
          <button type="button" className="crm-doc-arrow" aria-label={ui.documentsUi.nextFile} disabled={viewer.index === viewer.files.length - 1} onClick={() => onStep(1)}>›</button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------------------------------------- request sheet */

function RequestSheet({ data, ui, onClose, onDone }: {
  data: ClientCaseDTO;
  ui: UiCopy;
  onClose: () => void;
  onDone: (ok: boolean) => void;
}) {
  const t = ui.clientsUi.detail;
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const items = data.catalog.filter((item) =>
    !query.trim() || item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const list = groups.get(item.topic) ?? [];
    list.push(item);
    groups.set(item.topic, list);
  }
  async function send() {
    if (!picked.length || !data.leadId) return;
    setBusy(true);
    const ok = await post(`/api/leads/${data.leadId}/documents/request`, { docTypes: picked, note });
    setBusy(false);
    onDone(ok);
  }
  return (
    <dialog
      ref={ref}
      className="cl-sheet"
      aria-labelledby="cl-request-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="cl-sheet-body">
        <span className="cl-sheet-grip" aria-hidden="true" />
        <header className="cl-sheet-head">
          <h2 id="cl-request-title">{t.requestTitle}</h2>
          <button type="button" className="btn-icon" aria-label={t.close} onClick={() => ref.current?.close()}>
            <Icon name="x" />
          </button>
        </header>
        <p className="muted cl-sheet-hint">{t.requestHint}</p>
        <label className="cl-search-field">
          <span className="sr-only">{t.requestSearch}</span>
          <Icon name="search" small />
          <input type="search" value={query} placeholder={t.requestSearch} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="cl-catalog">
          {items.length === 0 ? <p className="muted">{t.requestNone}</p> : null}
          {[...groups.entries()].map(([topic, list]) => (
            <fieldset key={topic || "other"} className="cl-catalog-group">
              {topic ? <legend>{topic}</legend> : null}
              {list.map((item) => {
                const on = picked.includes(item.docType);
                return (
                  <label key={item.docType} className={`cl-pick${on ? " on" : ""}${item.open ? " busy" : ""}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={item.open}
                      onChange={() =>
                        setPicked((current) =>
                          current.includes(item.docType)
                            ? current.filter((value) => value !== item.docType)
                            : [...current, item.docType],
                        )
                      }
                    />
                    <span className="cl-pick-box" aria-hidden="true"><Icon name="check" small /></span>
                    <span className="cl-pick-label">{item.label}</span>
                    {item.open ? <span className="cl-chip idle">{t.requestOpen}</span> : null}
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>
        <label className="cl-field">
          <span>{t.requestNote}</span>
          <textarea rows={2} value={note} maxLength={500} placeholder={t.requestNotePlaceholder} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      <footer className="cl-sheet-foot">
        <button type="button" className="btn-secondary" onClick={() => ref.current?.close()}>{t.cancel}</button>
        <button type="button" className="btn" disabled={!picked.length || busy} aria-busy={busy} onClick={() => void send()}>
          {fillUi(t.requestSend, { n: picked.length })}
        </button>
      </footer>
    </dialog>
  );
}

/* -------------------------------------------------------------- chat sheet */

/**
 * The client's conversation inside the file: the same thread and staff composer
 * as the lead page (`LeadChat`), loaded from the lead view API, so the advisor
 * never leaves the Clients screen.
 */
function ChatSheet({ leadId, name, ui, lang, onClose }: {
  leadId: string;
  name: string;
  ui: UiCopy;
  lang: UiLang;
  onClose: () => void;
}) {
  const t = ui.clientsUi.detail;
  const ref = useRef<HTMLDialogElement>(null);
  const [dto, setDto] = useState<LeadViewDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setDto(await crmApi.view(leadId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [leadId]);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    void load();
  }, [load]);
  return (
    <dialog
      ref={ref}
      className="cl-sheet cl-chat-sheet"
      aria-labelledby="cl-chat-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="cl-sheet-body">
        <span className="cl-sheet-grip" aria-hidden="true" />
        <header className="cl-sheet-head">
          <h2 id="cl-chat-title">{fillUi(t.chatTitle, { name })}</h2>
          <button type="button" className="btn-icon" aria-label={t.close} onClick={() => ref.current?.close()}>
            <Icon name="x" />
          </button>
        </header>
        {dto ? (
          <LeadChat dto={dto} ui={ui} lang={lang} onSent={() => void load()} />
        ) : failed ? (
          <p className="cl-flash err" role="alert">{t.failed}</p>
        ) : (
          <div className="crm-lv-chat" aria-busy="true">
            <div className="crm-lv-chat-loading crm-skel-stack" aria-hidden="true">
              <span className="crm-skel w60" />
              <span className="crm-skel w80" />
              <span className="crm-skel w40" />
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

/* ---------------------------------------------------------------- doc row */

function DocRow({ row, ui, returning, picked, note, onPick, onNote, onView }: {
  row: CaseDocRow;
  ui: UiCopy;
  returning: boolean;
  picked: boolean;
  note: string;
  onPick: () => void;
  onNote: (value: string) => void;
  onView: () => void;
}) {
  const t = ui.clientsUi.detail;
  const ok = row.status === "uploaded";
  const issue = !ok && Boolean(row.reason);
  const selectable = returning && ok;
  const sub = issue ? reasonText(row.reason, ui) : row.requested ? t.requested : "";
  return (
    <li className={`cl-doc ${ok ? "ok" : issue ? "issue" : "missing"}${picked ? " picked" : ""}`}>
      <div className="cl-doc-line">
        {selectable ? (
          <label className="cl-doc-check">
            <input type="checkbox" checked={picked} onChange={onPick} aria-label={fillUi(t.returnPick, { label: row.label })} />
            <span className="cl-pick-box" aria-hidden="true"><Icon name="check" small /></span>
          </label>
        ) : (
          <span className="cl-doc-mark" aria-hidden="true">
            {ok ? <Icon name="check" small /> : issue ? <Icon name="alert" small /> : null}
          </span>
        )}
        <span className="cl-doc-text">
          <bdi className="cl-doc-label">{row.label}</bdi>
          <span className="cl-doc-sub">
            <span className="sr-only">{ok ? t.received : t.missing}. </span>
            {sub}
          </span>
        </span>
        {row.files.length ? (
          <button type="button" className="cl-doc-view" onClick={onView}>
            <Icon name="file" small />
            {row.files.length > 1 ? fillUi(t.files, { n: row.files.length }) : t.view}
          </button>
        ) : !ok ? (
          <span className="cl-doc-state">{t.missing}</span>
        ) : null}
      </div>
      {picked ? (
        <label className="cl-field cl-doc-note">
          <span>{t.returnNote}</span>
          <textarea rows={2} value={note} maxLength={500} placeholder={t.returnNotePlaceholder} onChange={(event) => onNote(event.target.value)} autoFocus />
        </label>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ case */

export function ClientCase({ data, ui, lang, now, backHref }: {
  data: ClientCaseDTO;
  ui: UiCopy;
  lang: UiLang;
  now: string;
  backHref: string;
}) {
  const t = ui.clientsUi;
  const d = t.detail;
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [returning, setReturning] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [requesting, setRequesting] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [reply, setReply] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const nowDate = useMemo(() => new Date(now), [now]);

  const current =
    data.waves.find((wave) => wave.state === "current") ??
    [...data.waves].reverse().find((wave) => wave.state === "done");
  const firstLocked = data.waves.findIndex((wave) => wave.state === "locked");
  const allRows = data.waves.flatMap((wave) => wave.topics.flatMap((topic) => topic.rows));
  const gallery = allRows.flatMap((row) => row.files.map((file) => ({ ...file, label: row.label, rowId: row.id })));
  const pickedIds = Object.keys(notes);
  // Document actions need a file: none before the client starts.
  const canAct = Boolean(data.leadId) && data.waves.length > 0;

  function done(ok: boolean, text: string) {
    setFlash(ok ? { text, tone: "ok" } : { text: d.failed, tone: "err" });
    if (ok) startRefresh(() => router.refresh());
  }

  async function run(name: string, url: string, body: unknown, okText: string, after?: () => void) {
    setBusy(name);
    setFlash(null);
    const ok = await post(url, body);
    setBusy(null);
    if (ok) after?.();
    done(ok, okText);
  }

  async function sendReply() {
    if (!data.task || !reply.trim()) return;
    const form = new FormData();
    form.set("mode", "direct");
    form.set("note", reply.trim());
    setBusy("reply");
    setFlash(null);
    let ok = false;
    try {
      ok = (await fetch(`/api/hitl/${data.task.id}/complete`, { method: "POST", body: form })).ok;
    } catch {
      ok = false;
    }
    setBusy(null);
    if (ok) setReply("");
    done(ok, d.replySent);
  }

  function sendReturn() {
    const groups = allRows
      .filter((row) => row.id in notes)
      .map((row) => ({ slotIds: row.slotIds, note: (notes[row.id] ?? "").trim() }));
    if (!groups.length || groups.some((group) => !group.note)) {
      setFlash({ text: d.returnNeedNote, tone: "err" });
      return;
    }
    void run("return", `/api/leads/${data.leadId}/documents/return`, { groups }, d.returnSent, () => {
      setReturning(false);
      setNotes({});
    });
  }

  function view(row: CaseDocRow) {
    const index = gallery.findIndex((file) => file.rowId === row.id);
    if (index >= 0) setViewer({ files: gallery, index });
  }

  const canChat = Boolean(data.leadId && data.hasConversation);
  const openChat = () => setChatOpen(true);

  /* ---- banner: the one thing to do now ---- */
  let banner: React.ReactNode = null;
  if (data.task?.kind === "review") {
    banner = (
      <div className="cl-callout needs">
        <div className="cl-callout-text">
          <h2>{d.reviewTitle}</h2>
          <p>{d.reviewBody}</p>
        </div>
        {!returning ? (
          <div className="cl-callout-actions">
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              aria-busy={busy === "approve"}
              onClick={() => void run("approve", `/api/leads/${data.leadId}/documents/approve`, undefined, d.approved)}
            >
              <Icon name="check" small />
              {d.approve}
            </button>
            <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => setReturning(true)}>
              {d.returnFiles}
            </button>
          </div>
        ) : null}
      </div>
    );
  } else if (data.task?.kind === "advisor") {
    banner = (
      <div className="cl-callout needs">
        <div className="cl-callout-text">
          <h2>{d.advisorTitle}</h2>
          {data.task.summary ? <p>{data.task.summary}</p> : null}
        </div>
        <label className="cl-field">
          <span>{d.replyLabel}</span>
          <textarea rows={3} value={reply} maxLength={2000} placeholder={d.replyPlaceholder} onChange={(event) => setReply(event.target.value)} />
        </label>
        <div className="cl-callout-actions">
          <button type="button" className="btn" disabled={!reply.trim() || busy !== null} aria-busy={busy === "reply"} onClick={() => void sendReply()}>
            {d.replySend}
          </button>
          {canChat ? <button type="button" className="btn-ghost" onClick={openChat}>{d.openChatInstead}</button> : null}
        </div>
      </div>
    );
  } else if (data.task?.kind === "invite_no_start" || data.task?.kind === "invite_send_unknown") {
    banner = (
      <div className="cl-callout needs">
        <div className="cl-callout-text">
          <h2>{data.task.kind === "invite_no_start" ? d.inviteNoStartTitle : d.inviteUnknownTitle}</h2>
          {data.task.summary ? <p>{data.task.summary}</p> : null}
        </div>
        <div className="cl-callout-actions">
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            aria-busy={busy === "handled"}
            onClick={() => void run("handled", `/api/leads/${data.leadId}/documents/invite-handled`, undefined, d.inviteHandledDone)}
          >
            {d.inviteHandled}
          </button>
          {canChat ? <button type="button" className="btn-ghost" onClick={openChat}>{t.openChat}</button> : null}
        </div>
      </div>
    );
  } else if (data.state === "stopped" && data.invite) {
    const byClient = data.invite.stop === "client_stop";
    banner = (
      <div className="cl-callout warn">
        <div className="cl-callout-text">
          <h2>{byClient ? d.stoppedClientTitle : d.stoppedRejectedTitle}</h2>
          <p>{byClient ? d.stoppedClientBody : d.stoppedRejectedBody}</p>
        </div>
      </div>
    );
  } else if (data.state === "invited" && (data.invite?.status === "escalated" || data.invite?.status === "unknown")) {
    banner = (
      <div className="cl-callout info">
        <div className="cl-callout-text">
          <h2>{data.invite.status === "escalated" ? d.inviteNoStartTitle : d.inviteUnknownTitle}</h2>
          <p>{d.inviteHandledBody}</p>
        </div>
      </div>
    );
  } else if (data.state === "invited" && data.invite) {
    const started = data.invite.status === "started";
    banner = (
      <div className="cl-callout info">
        <div className="cl-callout-text">
          <h2>{started ? d.startedTitle : d.invitedTitle}</h2>
          <p>{started ? d.startedBody : data.invite.status === "reminded" ? d.remindedBody : d.invitedBody}</p>
        </div>
      </div>
    );
  } else if (data.state === "waiting_id") {
    banner = (
      <div className="cl-callout info">
        <div className="cl-callout-text"><h2>{d.waitingIdTitle}</h2><p>{d.waitingIdBody}</p></div>
      </div>
    );
  } else if (data.state === "not_started") {
    banner = (
      <div className="cl-callout info">
        <div className="cl-callout-text">
          <h2>{d.notStartedTitle}</h2>
          <p>{d.notStartedBody}</p>
          {!canChat ? <p className="muted">{d.notStartedNoChat}</p> : null}
        </div>
      </div>
    );
  } else if (data.state === "complete" && data.nextWave) {
    banner = (
      <div className="cl-callout ready">
        <div className="cl-callout-text">
          <h2>{d.nextWaveTitle}</h2>
          <p>{fillUi(d.nextWaveBody, { wave: data.nextWave.label })}</p>
        </div>
        <div className="cl-callout-actions">
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            aria-busy={busy === "next"}
            onClick={() => void run("next", `/api/leads/${data.leadId}/documents/next-stage`, undefined, d.nextWaveSent)}
          >
            {fillUi(d.openNextWave, { wave: data.nextWave.label })}
          </button>
        </div>
      </div>
    );
  } else if (data.state === "complete") {
    banner = (
      <div className="cl-callout ok">
        <div className="cl-callout-text"><h2>{d.completeTitle}</h2><p>{d.completeBody}</p></div>
      </div>
    );
  } else if (data.stuckDays >= 4) {
    banner = (
      <div className="cl-callout warn">
        <div className="cl-callout-text">
          <h2>{fillUi(d.stuckTitle, { n: data.stuckDays })}</h2>
          <p>{d.stuckBody}</p>
        </div>
        {canChat ? (
          <div className="cl-callout-actions"><button type="button" className="btn-secondary" onClick={openChat}>{t.openChat}</button></div>
        ) : null}
      </div>
    );
  }

  function waveBody(wave: CaseWave) {
    return wave.topics.map((topic) => (
      <div key={topic.id} className="cl-topic">
        <h4>{topic.label}</h4>
        <ul className="cl-docs">
          {topic.rows.map((row) => (
            <DocRow
              key={row.id}
              row={row}
              ui={ui}
              returning={returning}
              picked={row.id in notes}
              note={notes[row.id] ?? ""}
              onPick={() =>
                setNotes((currentNotes) => {
                  const next = { ...currentNotes };
                  if (row.id in next) delete next[row.id];
                  else next[row.id] = "";
                  return next;
                })
              }
              onNote={(value) => setNotes((currentNotes) => ({ ...currentNotes, [row.id]: value }))}
              onView={() => view(row)}
            />
          ))}
        </ul>
      </div>
    ));
  }

  return (
    <article className={`cl-case${refreshing ? " refreshing" : ""}`}>
      <Link className="cl-back" href={backHref} scroll={false}>
        <Icon name="chevron" small />
        {t.back}
      </Link>

      <header className="cl-case-head">
        <span className={`cl-avatar lg ${data.state}`} aria-hidden="true">{initials(data.name)}</span>
        <div className="cl-case-id">
          <h1><bdi>{data.name}</bdi></h1>
          <p className="cl-case-meta">
            {data.phone ? <span dir="ltr">{data.phone}</span> : null}
            {data.test ? <span className="cl-chip test">{t.testChip}</span> : null}
            <span className="muted">
              {data.lastLeadMessageAt ? `${t.lastHeard}: ${relTime(data.lastLeadMessageAt, lang, nowDate)}` : t.never}
            </span>
          </p>
        </div>
        {canChat ? (
          <button type="button" className="btn-secondary cl-chat" onClick={openChat}>
            <Icon name="msg" small />
            <span>{t.openChat}</span>
          </button>
        ) : null}
      </header>

      {data.invite && (data.invite.openerAt || data.invite.startedAt) ? (
        <p className="cl-invite-line">
          <Icon name="msg" small />
          <span>{d.inviteTimeline}</span>
          {[
            data.invite.openerAt ? { at: data.invite.openerAt, label: d.inviteSentAt } : null,
            data.invite.reminderAt ? { at: data.invite.reminderAt, label: d.inviteReminderAt } : null,
            data.invite.startedAt ? { at: data.invite.startedAt, label: d.inviteStartedAt } : null,
          ]
            .filter((step): step is { at: string; label: string } => step !== null)
            .map((step) => (
              <span key={step.label} className="cl-invite-step">
                {step.label.split("{date}")[0]}
                <time dateTime={step.at} title={absTime(step.at, lang)}>{relTime(step.at, lang, nowDate)}</time>
                {step.label.split("{date}")[1] ?? ""}
              </span>
            ))}
        </p>
      ) : null}

      {flash ? (
        <p className={`cl-flash ${flash.tone}`} role={flash.tone === "err" ? "alert" : "status"}>{flash.text}</p>
      ) : null}

      {banner}

      {data.waves.length > 1 ? (
        <ol className="cl-stepper" aria-label={d.waves}>
          {data.waves.map((wave, index) => (
            <li key={wave.id} className={`cl-step ${wave.state}`} aria-current={wave.state === "current" ? "step" : undefined}>
              <span className="cl-step-dot" aria-hidden="true">
                {wave.state === "done" ? <Icon name="check" small /> : wave.state === "locked" ? <Icon name="lock" small /> : index + 1}
              </span>
              <span className="cl-step-text">
                <span className="cl-step-label">{wave.label}</span>
                <span className="cl-step-state">
                  {wave.state === "locked"
                    ? (index === firstLocked ? d.waveNext : d.waveLater)
                    : `${wave.state === "done" ? d.waveDone : d.waveCurrent} · ${fillUi(d.docsCount, { done: wave.done, total: wave.total })}`}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {data.waves.length ? (
        <section className="cl-checklist" aria-label={current?.label ?? d.waves}>
          <div className="cl-checklist-head">
            <h3>
              {current?.label}
              {current ? <span className="cl-count">{fillUi(d.docsCount, { done: current.done, total: current.total })}</span> : null}
            </h3>
            {canAct && !returning ? (
              <button type="button" className="crm-btn-quiet cl-add" onClick={() => setRequesting(true)}>
                <Icon name="plus" small />
                {d.requestDocs}
              </button>
            ) : null}
          </div>
          {returning ? <p className="cl-return-hint">{d.returnHint}</p> : null}
          {current ? waveBody(current) : null}
          {data.waves
            .filter((wave) => wave !== current && wave.state !== "locked" && wave.total > 0)
            .map((wave) => (
              <details key={wave.id} className="cl-oldwave">
                <summary>
                  <Icon name="check" small />
                  {wave.label}
                  <span className="cl-count">{fillUi(d.docsCount, { done: wave.done, total: wave.total })}</span>
                </summary>
                {waveBody(wave)}
              </details>
            ))}
          {data.waves.filter((wave) => wave.state === "locked").map((wave) => (
            <p key={wave.id} className="cl-locked">
              <Icon name="lock" small />
              <span><strong>{wave.label}</strong> {d.waveLockedBody}</span>
            </p>
          ))}
        </section>
      ) : null}

      {data.log.length || data.waves.length ? (
        <section className="cl-log" aria-label={d.log}>
          <h3>{d.log}</h3>
          {data.log.length === 0 ? (
            <p className="muted">{d.logEmpty}</p>
          ) : (
            <ol>
              {data.log.map((item) => {
                const status = d.logStatus[item.status as keyof typeof d.logStatus] ?? item.status;
                const returned = item.reason && !(item.reason in ui.documentsUi.reasons) ? fillUi(d.returnedNote, { note: item.reason }) : reasonText(item.reason, ui);
                return (
                  <li key={item.id} className={`cl-log-item ${item.status}`}>
                    <span className="cl-log-dot" aria-hidden="true" />
                    <span className="cl-log-main">
                      <span className="cl-log-top">
                        <bdi>{item.label || item.filename}</bdi>
                        <span className={`cl-log-status ${item.status}`}>{status}</span>
                      </span>
                      <span className="cl-log-sub">
                        <time dateTime={item.at} title={absTime(item.at, lang)}>{relTime(item.at, lang, nowDate)}</time>
                        {item.status === "rejected" && returned ? <> · {returned}</> : null}
                      </span>
                    </span>
                    {item.href ? (
                      <button type="button" className="cl-doc-view" onClick={() => setViewer({ files: [{ href: item.href, mime: item.mime, label: item.label || item.filename }], index: 0 })}>
                        {d.view}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}

      {data.contact && (data.contact.dealDate || data.contact.fields.length) ? (
        <section className="cl-crm" aria-labelledby="cl-crm-title">
          <h3 id="cl-crm-title">
            <span>{d.crm}</span>
          </h3>
          <dl>
            {data.contact.dealDate ? (
              <div><dt>{d.dealDate}</dt><dd>{new Date(data.contact.dealDate).toLocaleDateString(lang === "he" ? "he-IL" : "en-GB", { month: "2-digit", year: "numeric" })}</dd></div>
            ) : null}
            {data.contact.fields.map((field) => (
              <div key={field.key}><dt>{field.label}</dt><dd><bdi>{field.value}</bdi></dd></div>
            ))}
          </dl>
        </section>
      ) : null}

      {returning ? (
        <div className="cl-actionbar" role="region" aria-label={d.returnTitle}>
          <span className="cl-actionbar-text">{d.returnTitle}</span>
          <button type="button" className="btn-secondary" onClick={() => { setReturning(false); setNotes({}); setFlash(null); }}>{d.cancel}</button>
          <button type="button" className="btn" disabled={!pickedIds.length || busy !== null} aria-busy={busy === "return"} onClick={sendReturn}>
            {fillUi(d.returnSend, { n: pickedIds.length })}
          </button>
        </div>
      ) : null}

      {requesting ? (
        <RequestSheet
          data={data}
          ui={ui}
          onClose={() => setRequesting(false)}
          onDone={(ok) => {
            setRequesting(false);
            done(ok, d.requestSent);
          }}
        />
      ) : null}

      {chatOpen && data.leadId ? (
        <ChatSheet
          leadId={data.leadId}
          name={data.name}
          ui={ui}
          lang={lang}
          onClose={() => {
            setChatOpen(false);
            // A message sent from the sheet changes the file's last activity.
            startRefresh(() => router.refresh());
          }}
        />
      ) : null}

      {mounted && viewer ? (
        <FileViewer
          viewer={viewer}
          ui={ui}
          onClose={() => setViewer(null)}
          onStep={(delta) =>
            setViewer((currentViewer) => {
              if (!currentViewer) return currentViewer;
              const index = Math.min(currentViewer.files.length - 1, Math.max(0, currentViewer.index + delta));
              return { ...currentViewer, index };
            })
          }
        />
      ) : null}
    </article>
  );
}
