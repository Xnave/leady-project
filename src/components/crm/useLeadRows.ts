"use client";

import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState, useTransition } from "react";
import type { LeadRowDTO } from "@/lib/crm/view";
import type { PipelineStage } from "@/lib/crm/types";
import { fillUi, type UiCopy } from "@/lib/ui";
import { crmApi } from "./crm-client";
import {
  matchesView,
  mergePending,
  restoreRows,
  withNextStep,
  withStage,
  type ViewFilter,
} from "./rows";
import { stageLabel } from "./StageMenu";
import { useToasts } from "./Toasts";
import { useLeadAbsorb } from "./useLeadAbsorb";
import { usePendingEdits, type Tokens } from "./usePendingEdits";

/** Matches the `.crm-row` opacity/transform transition. */
const LEAVE_MS = 160;
type Saved = { row: LeadRowDTO; index: number }[];

/**
 * The list's rows with optimistic owner actions. Every action updates locally first,
 * rolls back with an error toast on failure, and reconciles with `router.refresh()`.
 * In-flight edits are kept in `pending` and laid over every refresh, so one action's
 * refresh never reverts another that has not committed yet. A snooze is deferred: it
 * only reaches the server when its undo toast runs out.
 */
export function useLeadRows(o: {
  initialRows: LeadRowDTO[];
  view: ViewFilter;
  ui: UiCopy;
  lang: "he" | "en";
  wonLabel: string;
}) {
  const { ui, lang, wonLabel } = o;
  const router = useRouter();
  const toast = useToasts();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState(o.initialRows);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const viewRef = useRef(o.view);
  viewRef.current = o.view;
  const leavingRef = useRef(new Set<string>());
  const { pending, track, settle, afterMerge } = usePendingEdits();

  // New server rows (URL change or refresh) replace local state, with in-flight edits re-applied.
  const firstRows = useRef(o.initialRows);
  useLayoutEffect(() => {
    if (o.initialRows === firstRows.current) return;
    firstRows.current = o.initialRows;
    const { rows: merged, drop, missed } = mergePending(o.initialRows, pending.current, viewRef.current);
    afterMerge(drop, missed);
    leavingRef.current = new Set();
    setLeaving(new Set());
    setRows(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- afterMerge / pending are ref-backed
  }, [o.initialRows]);

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const failed = useCallback(() => toast({ msg: ui.crm.loadFailed }), [toast, ui]);

  const snapshot = (ids: string[]): Saved =>
    rowsRef.current.flatMap((row, index) => (ids.includes(row.id) ? [{ row, index }] : []));

  const setLeavingIds = (fn: (s: Set<string>) => void) => {
    const next = new Set(leavingRef.current);
    fn(next);
    leavingRef.current = next;
    setLeaving(next);
  };

  /** Apply changed rows; ones that no longer fit the view fade out, then drop. */
  const apply = (changed: LeadRowDTO[]) => {
    const byId = new Map(changed.map((r) => [r.id, r]));
    setRows((cur) => cur.map((r) => byId.get(r.id) ?? r));
    const gone = changed.filter((r) => !matchesView(r, viewRef.current)).map((r) => r.id);
    if (!gone.length) return;
    setLeavingIds((s) => gone.forEach((id) => s.add(id)));
    setTimeout(() => {
      const still = gone.filter((id) => leavingRef.current.has(id));
      setRows((cur) => cur.filter((r) => !still.includes(r.id)));
      setLeavingIds((s) => still.forEach((id) => s.delete(id)));
    }, LEAVE_MS);
  };

  /** Optimistic edit: apply locally and track it as in flight. */
  const edit = (saved: Saved, change: (r: LeadRowDTO) => LeadRowDTO): Tokens => {
    const after = saved.map((s) => change(s.row));
    apply(after);
    return track(saved.map((s, i) => ({ before: s.row, after: after[i], index: s.index })));
  };

  const restore = (saved: Saved) => {
    setLeavingIds((s) => saved.forEach((x) => s.delete(x.row.id)));
    setRows((cur) => restoreRows(cur, saved));
  };

  const setStage = useCallback(
    (ids: string[], stage: PipelineStage, reason: string) => {
      const saved = snapshot(ids);
      if (!saved.length) return;
      const tokens = edit(saved, (r) => withStage(r, stage));
      const call =
        saved.length === 1
          ? crmApi.setStage(saved[0].row.id, stage, reason)
          : crmApi.bulk({ ids: saved.map((s) => s.row.id), op: "stage", stage, reason });
      call.then(
        () => {
          settle(tokens, true);
          refresh();
          toast({
            msg: fillUi(ui.crm.stageSet, { stage: stageLabel(ui, wonLabel, stage) }),
            undo: () => {
              restore(saved);
              const undoTokens = track(saved.map((s) => ({ before: withStage(s.row, stage), after: s.row, index: s.index })));
              Promise.all(saved.map((s) => crmApi.setStage(s.row.id, s.row.stage))).then(
                () => {
                  settle(undoTokens, true);
                  refresh();
                },
                () => {
                  settle(undoTokens, false);
                  failed();
                  refresh();
                },
              );
            },
          });
        },
        () => {
          settle(tokens, false);
          restore(saved);
          failed();
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers read refs only
    [refresh, failed, toast, ui, wonLabel],
  );

  const setNextStep = useCallback(
    (id: string, at: string, text: string) => {
      const saved = snapshot([id]);
      if (!saved.length) return;
      const t = text || saved[0].row.nextStepText || null;
      const tokens = edit(saved, (r) => withNextStep(r, t, at));
      crmApi.setNextStep(id, { text: t, at }).then(
        () => {
          settle(tokens, true);
          refresh();
          toast({ msg: ui.crm.nextSaved });
        },
        () => {
          settle(tokens, false);
          restore(saved);
          failed();
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers read refs only
    [refresh, failed, toast, ui],
  );

  /** Mark rows read (`unread=false`) or unread. Only rows whose state actually changes are sent. */
  const setUnread = useCallback(
    (ids: string[], unread: boolean) => {
      const saved = snapshot(ids).filter((s) => s.row.unread !== unread);
      if (!saved.length) return;
      const tokens = edit(saved, (r) => ({ ...r, unread }));
      const call =
        saved.length === 1
          ? crmApi.setUnread(saved[0].row.id, unread)
          : crmApi.bulk({ ids: saved.map((s) => s.row.id), op: unread ? "unread" : "read" });
      call.then(
        () => {
          settle(tokens, true);
          refresh();
        },
        () => {
          settle(tokens, false);
          restore(saved);
          failed();
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers read refs only
    [refresh, failed],
  );

  const markRead = useCallback((ids: string[]) => setUnread(ids, false), [setUnread]);

  /** Reports from the peek panel, per action (see `useLeadAbsorb`). */
  const absorb = useLeadAbsorb({ pending, snapshot, edit, apply, settle, refresh });

  return { rows, leaving, setStage, setNextStep, markRead, setUnread, absorb };
}
