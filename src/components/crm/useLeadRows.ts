"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import type { LeadRowDTO } from "@/lib/crm/view";
import type { PipelineStage } from "@/lib/crm/types";
import { fillUi, type UiCopy } from "@/lib/ui";
import { crmApi, type SnoozeDays } from "./crm-client";
import { presetAt } from "./format";
import { matchesView, restoreRows, withNextStep, withSnooze, withStage, type ViewFilter } from "./rows";
import { snoozeLabel } from "./SnoozeMenu";
import { stageLabel } from "./StageMenu";
import { useToasts } from "./Toasts";

/** Matches the `.crm-row` opacity/transform transition. */
const LEAVE_MS = 160;
type Saved = { row: LeadRowDTO; index: number }[];

/**
 * The list's rows with optimistic owner actions. Every action updates locally first,
 * rolls back with an error toast on failure, and reconciles with `router.refresh()`.
 * A snooze is deferred: it only reaches the server when its undo toast runs out.
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
  /** Snoozes still inside their undo window: a refresh must not bring these rows back. */
  const pendingSnooze = useRef(new Map<string, LeadRowDTO>());

  // New server rows (URL change or refresh) replace local state, keeping pending snoozes applied.
  const [src, setSrc] = useState(o.initialRows);
  if (src !== o.initialRows) {
    setSrc(o.initialRows);
    setRows(
      o.initialRows.flatMap((r) => {
        const p = pendingSnooze.current.get(r.id);
        if (!p) return [r];
        const snoozed = withSnooze(r, p.snoozedUntil ?? "");
        return matchesView(snoozed, o.view) ? [snoozed] : [];
      }),
    );
    leavingRef.current = new Set();
    setLeaving(new Set());
  }

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
  const apply = useCallback((changed: LeadRowDTO[]) => {
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
  }, []);

  const restore = useCallback((saved: Saved) => {
    setLeavingIds((s) => saved.forEach((x) => s.delete(x.row.id)));
    setRows((cur) => restoreRows(cur, saved));
  }, []);

  const setStage = useCallback(
    (ids: string[], stage: PipelineStage, reason: string) => {
      const saved = snapshot(ids);
      if (!saved.length) return;
      apply(saved.map((s) => withStage(s.row, stage)));
      const call =
        saved.length === 1
          ? crmApi.setStage(saved[0].row.id, stage, reason)
          : crmApi.bulk({ ids: saved.map((s) => s.row.id), op: "stage", stage, reason });
      call.then(
        () => {
          refresh();
          toast({
            msg: fillUi(ui.crm.stageSet, { stage: stageLabel(ui, wonLabel, stage) }),
            undo: () => {
              restore(saved);
              Promise.all(saved.map((s) => crmApi.setStage(s.row.id, s.row.stage))).then(refresh, () => {
                failed();
                refresh();
              });
            },
          });
        },
        () => {
          restore(saved);
          failed();
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot reads refs only
    [apply, restore, refresh, failed, toast, ui, wonLabel],
  );

  const snooze = useCallback(
    (ids: string[], days: SnoozeDays) => {
      const saved = snapshot(ids);
      if (!saved.length) return;
      const until = presetAt(days);
      saved.forEach((s) => pendingSnooze.current.set(s.row.id, withSnooze(s.row, until)));
      apply(saved.map((s) => withSnooze(s.row, until)));
      const label = snoozeLabel(ui, days);
      const drop = () => saved.forEach((s) => pendingSnooze.current.delete(s.row.id));
      toast({
        msg: fillUi(ui.crm.snoozed, { when: lang === "en" ? label.toLowerCase() : label }),
        undo: () => {
          drop();
          restore(saved);
        },
        onExpire: () => {
          const call =
            saved.length === 1
              ? crmApi.snooze(saved[0].row.id, days)
              : crmApi.bulk({ ids: saved.map((s) => s.row.id), op: "snooze", days });
          call.then(
            () => {
              drop();
              refresh();
            },
            () => {
              drop();
              restore(saved);
              failed();
            },
          );
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot reads refs only
    [apply, restore, refresh, failed, toast, ui, lang],
  );

  const setNextStep = useCallback(
    (id: string, days: SnoozeDays, text: string) => {
      const saved = snapshot([id]);
      if (!saved.length) return;
      const at = presetAt(days);
      const t = text || saved[0].row.nextStepText || null;
      apply([withNextStep(saved[0].row, t, at)]);
      crmApi.setNextStep(id, { text: t, at }).then(
        () => {
          refresh();
          toast({ msg: ui.crm.nextSaved });
        },
        () => {
          restore(saved);
          failed();
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot reads refs only
    [apply, restore, refresh, failed, toast, ui],
  );

  const markRead = useCallback(
    (ids: string[]) => {
      const saved = snapshot(ids).filter((s) => s.row.unread);
      if (!saved.length) return;
      apply(saved.map((s) => ({ ...s.row, unread: false })));
      const call =
        saved.length === 1
          ? crmApi.markRead(saved[0].row.id)
          : crmApi.bulk({ ids: saved.map((s) => s.row.id), op: "read" });
      call.then(refresh, () => {
        restore(saved);
        failed();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot reads refs only
    [apply, restore, refresh, failed],
  );

  return { rows, leaving, setStage, snooze, setNextStep, markRead };
}
