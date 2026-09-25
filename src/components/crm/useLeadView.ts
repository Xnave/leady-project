"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeadRowDTO, LeadViewDTO } from "@/lib/crm/view";
import type { PipelineStage } from "@/lib/crm/types";
import { fillUi, type UiCopy } from "@/lib/ui";
import { crmApi, type SnoozeDays } from "./crm-client";
import { presetAt } from "./format";
import { rowPatchFromView } from "./lead-view";
import { undoPatch, withNextStep, withSnooze, withStage, type PeekReport } from "./rows";
import { snoozeLabel } from "./SnoozeMenu";
import { stageLabel } from "./StageMenu";
import { useToastsOptional, type ToastInput } from "./Toasts";

/**
 * `optimistic`: shown before the request lands. `confirmed`: the request succeeded (the
 * row is the reloaded server view when the reload worked). `failed`: undo this action.
 */
export type ChangePhase = PeekReport["phase"];
type Note = LeadViewDTO["notes"][number];

/** Action tokens, unique across remounts (0 means "no action", e.g. a reload after a chat send). */
let nextAction = 1;

/** The fields `after` changed, with their `before` values, for any object shape. */
function undoFields<T extends object>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) if (after[k] !== before[k]) out[k] = before[k];
  return out;
}

/** The list-row fields this action changed, with their values from before it. */
const rowUndo = (before: LeadViewDTO, after: LeadViewDTO) =>
  undoPatch(rowPatchFromView(before) as LeadRowDTO, rowPatchFromView(after) as LeadRowDTO);

/**
 * One lead's view with optimistic owner actions. Each action patches the view at once,
 * reports the row change to the list (`onChanged`), runs its request, then reloads the
 * view so the timeline and derived fields come from the server. A failure rolls back
 * and shows the error toast. Reloads are held while another action is still in flight,
 * so an early reload never wipes a later optimistic change.
 */
export function useLeadView(o: {
  dto: LeadViewDTO;
  ui: UiCopy;
  lang: "he" | "en";
  wonLabel: string;
  onChanged?: (report: PeekReport) => void;
}) {
  const { ui, lang, wonLabel } = o;
  const toast = useToastsOptional();
  const [d, setD] = useState(o.dto);
  // A new DTO from the parent (another lead, or a fresh fetch) replaces local state.
  const [seen, setSeen] = useState(o.dto);
  if (seen !== o.dto) {
    setSeen(o.dto);
    setD(o.dto);
  }
  const dRef = useRef(d);
  dRef.current = d;
  const changedRef = useRef(o.onChanged);
  useEffect(() => {
    changedRef.current = o.onChanged;
  });
  const inflight = useRef(0);
  const reloadSeq = useRef(0);

  const report = useCallback(
    (next: LeadViewDTO, phase: ChangePhase, action: number, undo?: Partial<LeadRowDTO>) =>
      changedRef.current?.({ row: rowPatchFromView(next), phase, action, undo }),
    [],
  );

  /** Undo one action locally and in the list: only the fields it changed go back. */
  const rollback = useCallback(
    (before: LeadViewDTO, after: LeadViewDTO, action: number) => {
      const undo = undoFields(before, after);
      setD((cur) => (cur.id === before.id ? { ...cur, ...undo } : cur));
      report(before, "failed", action, rowUndo(before, after));
    },
    [report],
  );

  /** Reload the view; `action` is the action whose success it confirms (0 for none). */
  const reload = useCallback(async (action = 0) => {
    const id = dRef.current.id;
    const seq = ++reloadSeq.current;
    try {
      const fresh = await crmApi.view(id);
      if (seq !== reloadSeq.current || inflight.current > 0 || dRef.current.id !== fresh.id) return;
      setD(fresh);
      report(fresh, "confirmed", action);
    } catch {
      // The request itself succeeded: confirm the optimistic row so the list stops holding it.
      if (seq === reloadSeq.current && inflight.current === 0) report(dRef.current, "confirmed", action);
    }
  }, [report]);

  /** Apply `change` locally, run `call`, then reload. Resolves true on success. */
  const mutate = useCallback(
    (change: (cur: LeadViewDTO) => LeadViewDTO, call: () => Promise<unknown>, done?: ToastInput): Promise<boolean> => {
      const action = nextAction++;
      const before = dRef.current;
      const after = change(before);
      setD(after);
      report(after, "optimistic", action);
      inflight.current += 1;
      return call().then(
        () => {
          inflight.current -= 1;
          if (done) toast(done);
          void reload(action);
          return true;
        },
        () => {
          inflight.current -= 1;
          rollback(before, after, action);
          toast({ msg: ui.crm.loadFailed });
          return false;
        },
      );
    },
    [reload, report, rollback, toast, ui],
  );

  const setStage = (stage: PipelineStage, reason: string) => {
    const prev = dRef.current;
    const id = prev.id;
    void mutate(
      (cur) => ({ ...cur, ...withStage(cur, stage), stageReason: reason }),
      () => crmApi.setStage(id, stage, reason),
      {
        msg: fillUi(ui.crm.stageSet, { stage: stageLabel(ui, wonLabel, stage) }),
        // Same undo as the list: set the previous stage back (the lead stays manual).
        undo: () =>
          void mutate(
            (cur) => ({ ...cur, ...withStage(cur, prev.stage), stageReason: "" }),
            () => crmApi.setStage(id, prev.stage),
          ),
      },
    );
  };

  const setNext = (text: string | null, at: string) => {
    const id = dRef.current.id;
    return mutate(
      (cur) => ({ ...cur, ...withNextStep(cur, text, at) }),
      () => crmApi.setNextStep(id, { text, at }),
      { msg: ui.crm.nextSaved },
    );
  };

  const markDone = () => {
    const id = dRef.current.id;
    return mutate(
      (cur) => ({
        ...cur,
        nextStepText: null,
        nextStepAt: null,
        ...(cur.followUpReason === "reminder" ? { followUpReason: null, followUpAt: null, due: false } : {}),
      }),
      () => crmApi.setNextStep(id, { done: true }),
      { msg: ui.crm.markedDone },
    );
  };

  /** Deferred like the list's snooze: it reaches the server when the undo toast runs out. */
  const snooze = (days: SnoozeDays) => {
    const action = nextAction++;
    const before = dRef.current;
    const after = { ...before, ...withSnooze(before, presetAt(days)) };
    setD(after);
    report(after, "optimistic", action);
    const label = snoozeLabel(ui, days);
    const undo = () => rollback(before, after, action);
    toast({
      msg: fillUi(ui.crm.snoozed, { when: lang === "en" ? label.toLowerCase() : label }),
      undo,
      onExpire: () => {
        inflight.current += 1;
        crmApi.snooze(before.id, days).then(
          () => {
            inflight.current -= 1;
            void reload(action);
          },
          () => {
            inflight.current -= 1;
            undo();
            toast({ msg: ui.crm.loadFailed });
          },
        );
      },
    });
  };

  const addNote = (body: string) => {
    const id = dRef.current.id;
    const temp: Note = { id: `tmp-${Date.now()}`, body, authorLabel: "", pinned: false, createdAt: new Date().toISOString() };
    return mutate((cur) => ({ ...cur, notes: [temp, ...cur.notes] }), () => crmApi.addNote(id, body));
  };

  const pinNote = (noteId: string, pinned: boolean) => {
    const id = dRef.current.id;
    void mutate(
      (cur) => ({ ...cur, notes: cur.notes.map((n) => (n.id === noteId ? { ...n, pinned } : n)) }),
      () => crmApi.pinNote(id, noteId, pinned),
    );
  };

  return { d, reload, setStage, setNext, markDone, snooze, addNote, pinNote };
}
