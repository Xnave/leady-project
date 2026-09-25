"use client";

import { useRef } from "react";
import type { LeadRowDTO } from "@/lib/crm/view";
import { diffRow, type PendingEdit } from "./rows";

/** Which edit (by token) each lead's request belongs to, so only its own settle clears it. */
export type Tokens = Map<string, number>;

/**
 * In-flight optimistic edits, keyed by lead id. `useLeadRows` lays them over every
 * refresh (`mergePending`) so one action's refresh cannot revert another's edit.
 */
export function usePendingEdits() {
  const pending = useRef(new Map<string, PendingEdit>());
  const nextToken = useRef(1);

  /** Record edits (before → after) as in flight; returns each lead's token. */
  const track = (pairs: { before: LeadRowDTO; after: LeadRowDTO; index: number }[]): Tokens => {
    const tokens: Tokens = new Map();
    for (const { before, after, index } of pairs) {
      const token = nextToken.current++;
      const prev = pending.current.get(after.id);
      pending.current.set(after.id, {
        token,
        patch: { ...prev?.patch, ...diffRow(before, after) },
        row: after,
        index,
        settled: false,
        misses: 0,
      });
      tokens.set(after.id, token);
    }
    return tokens;
  };

  /** A request finished: success keeps the edit until a refresh shows it; failure or undo drops it. */
  const settle = (tokens: Tokens, ok: boolean) => {
    for (const [id, token] of tokens) {
      const p = pending.current.get(id);
      if (!p || p.token !== token) continue;
      if (ok) p.settled = true;
      else pending.current.delete(id);
    }
  };

  /** After a merge: forget dropped edits and count the ones the refresh missed. */
  const afterMerge = (drop: string[], missed: string[]) => {
    drop.forEach((id) => pending.current.delete(id));
    missed.forEach((id) => {
      const p = pending.current.get(id);
      if (p) p.misses += 1;
    });
  };

  return { pending, track, settle, afterMerge };
}
