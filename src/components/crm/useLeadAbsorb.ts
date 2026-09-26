"use client";

import { useCallback, useRef } from "react";
import type { LeadRowDTO } from "@/lib/crm/view";
import { absorbStep, diffRow, type PeekReport, type PendingEdit } from "./rows";
import type { Tokens } from "./usePendingEdits";

type Saved = { row: LeadRowDTO; index: number }[];

/** The pieces of `useLeadRows` the peek's reports go through. */
export type AbsorbDeps = {
  pending: { current: Map<string, PendingEdit> };
  snapshot: (ids: string[]) => Saved;
  edit: (saved: Saved, change: (r: LeadRowDTO) => LeadRowDTO) => Tokens;
  apply: (changed: LeadRowDTO[]) => void;
  settle: (tokens: Tokens, ok: boolean) => void;
  refresh: () => void;
};

/**
 * Peek-panel reports, per action, through the list's pending-edit path. Each lead's pending
 * edit remembers which peek action last wrote it; only that action may settle it or roll it
 * back (see `absorbStep`), so an older action's failure never clobbers a newer one.
 */
export function useLeadAbsorb(deps: AbsorbDeps) {
  const d = useRef(deps);
  d.current = deps;
  /** lead id → the peek action and pending token that last wrote its pending edit. */
  const owner = useRef(new Map<string, { action: number; token: number }>());

  return useCallback((r: PeekReport) => {
    const { pending, snapshot, edit, apply, settle, refresh } = d.current;
    const id = r.row.id;
    const held = pending.current.get(id);
    const own = owner.current.get(id);
    const heldAction = !held ? undefined : own && own.token === held.token ? own.action : -1;
    const saved = snapshot([id]);
    const merge = (patch: Partial<LeadRowDTO>) => {
      if (!saved.length) return null;
      const next = { ...saved[0].row, ...patch };
      return Object.keys(diffRow(saved[0].row, next)).length ? next : null;
    };
    const record = (tokens: Tokens) => {
      const token = tokens.get(id);
      if (token !== undefined) owner.current.set(id, { action: r.action, token });
    };

    switch (absorbStep(r.phase, r.action, heldAction)) {
      case "track": {
        const next = merge(r.row);
        if (next) record(edit(saved, () => next));
        return;
      }
      case "settle": {
        const next = merge(r.row);
        if (next) {
          const tokens = edit(saved, () => next);
          record(tokens);
          settle(tokens, true);
        } else if (held) {
          settle(new Map([[id, held.token]]), true);
        }
        break;
      }
      case "apply": {
        const next = merge(r.row);
        if (next) apply([next]);
        break;
      }
      case "rollback": {
        if (held) settle(new Map([[id, held.token]]), false);
        owner.current.delete(id);
        const next = merge(r.undo ?? {});
        if (next) apply([next]);
        break;
      }
      case "ignore":
        return;
      case "refresh":
        break;
    }
    refresh();
  }, []);
}
