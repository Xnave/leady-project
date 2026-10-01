"use client";

import { useState } from "react";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import { absTime, relTime, type Clock } from "./format";
import { Icon } from "./Icon";

type Note = LeadViewDTO["notes"][number];

/** Pinned first, then newest first. */
function ordered(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

/**
 * Internal notes: the list (pinned first) and a textarea. Cmd/Ctrl+Enter or Save adds a
 * note; it shows at once and the draft comes back if the save fails.
 */
export function LeadNotes({
  notes,
  ui,
  lang,
  clock,
  onAdd,
  onPin,
}: {
  notes: Note[];
  ui: UiCopy;
  lang: "he" | "en";
  clock: Clock | null;
  onAdd: (body: string) => Promise<boolean>;
  onPin: (id: string, pinned: boolean) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    void onAdd(body).then((ok) => {
      if (!ok) setDraft((cur) => cur || body);
    });
  };

  return (
    <section className="crm-sec" aria-label={ui.crm.notes}>
      <div className="crm-sec-h">
        <Icon name="note" small />
        {ui.crm.notes}
        {notes.length ? <span className="crm-count">{notes.length}</span> : null}
        <span className="crm-sec-aside">{ui.crm.notesHint}</span>
      </div>
      {notes.length ? (
        <ul className="crm-notes">
          {ordered(notes).map((n) => {
            const temp = n.id.startsWith("tmp-");
            const when = clock ? relTime(n.createdAt, lang, clock.now) : "";
            return (
              <li key={n.id} className={n.pinned ? "crm-note pinned" : "crm-note"} aria-busy={temp || undefined}>
                <p>{n.body}</p>
                <small>
                  {n.pinned ? <Icon name="pin" small /> : null}
                  <span title={clock ? absTime(n.createdAt, lang) : undefined}>
                    {[n.authorLabel, when].filter(Boolean).join(" · ")}
                  </span>
                </small>
                {temp ? null : (
                  <button
                    type="button"
                    className="crm-ibtn crm-note-pin"
                    aria-pressed={n.pinned}
                    aria-label={n.pinned ? ui.crm.unpin : ui.crm.pin}
                    title={n.pinned ? ui.crm.unpin : ui.crm.pin}
                    onClick={() => onPin(n.id, !n.pinned)}
                  >
                    <Icon name="pin" small />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="crm-note-add">
        <textarea
          value={draft}
          maxLength={4000}
          placeholder={ui.crm.addNote}
          aria-label={ui.crm.addNote}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
        />
        <div className="crm-note-foot">
          <span>{ui.crm.saveHint}</span>
          <button type="button" className="crm-btn-quiet" disabled={!draft.trim()} onClick={add}>
            {ui.crm.saveNote}
          </button>
        </div>
      </div>
    </section>
  );
}
