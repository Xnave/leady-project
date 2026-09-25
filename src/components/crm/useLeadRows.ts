"use client";

import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState, useTransition } from "react";
import type { LeadRowDTO } from "@/lib/crm/view";
import type { PipelineStage } from "@/lib/crm/types";
import { fillUi, type UiCopy } from "@/lib/ui";
import { crmApi, type SnoozeDays } from "./crm-client";
import { presetAt } from "./format";
import {
  matchesView,
  mergePending,
  restoreRows,
  withNextStep,
  withSnooze,
  withStage,
  type ViewFilter,
} from "./rows";
import { snoozeLabel } from "./SnoozeMenu";
import { stageLabel } from "./StageMenu";
import { useToasts } from "./Toasts";
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

  const snooze = useCallback(
    (ids: string[], days: SnoozeDays) => {
      const saved = snapshot(ids);
      if (!saved.length) return;
      const until = presetAt(days);
      const tokens = edit(saved, (r) => withSnooze(r, until));
      const label = snoozeLabel(ui, days);
      toast({
        msg: fillUi(ui.crm.snoozed, { when: lang === "en" ? label.toLowerCase() : label }),
        undo: () => {
          settle(tokens, false);
          restore(saved);
        },
        onExpire: () => {
          const call =
            saved.length === 1
              ? crmApi.snooze(saved[0].row.id, days)
              : crmApi.bulk({ ids: saved.map((s) => s.row.id), op: "snooze", days });
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
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers read refs only
    [refresh, failed, toast, ui, lang],
  );

  const setNextStep = useCallback(
    (id: string, days: SnoozeDays, text: string) => {
      const saved = snapshot([id]);
      if (!saved.length) return;
      const at = presetAt(days);
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

  const markRead = useCallback(
    (ids: string[]) => {
      const saved = snapshot(ids).filter((s) => s.row.unread);
      if (!saved.length) return;
      const tokens = edit(saved, (r) => ({ ...r, unread: false }));
      const call =
        saved.length === 1
          ? crmApi.markRead(saved[0].row.id)
          : crmApi.bulk({ ids: saved.map((s) => s.row.id), op: "read" });
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

  return { rows, leaving, setStage, snooze, setNextStep, markRead };
}
