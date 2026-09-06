"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Select } from "@/components/Select";
import type { LeadStatusId } from "@/lib/ui";

export function LeadStatusSelect({
  leadId,
  value,
  labels,
  ariaLabel,
  failedLabel,
}: {
  leadId: string;
  value: LeadStatusId;
  labels: Record<LeadStatusId, string>;
  ariaLabel?: string;
  failedLabel?: string;
}) {
  const router = useRouter();
  const statuses = Object.keys(labels) as LeadStatusId[];

  // Optimistic: the select shows the new status immediately, and rolls back to
  // the server value if the write fails, so the row never lies about state.
  const [optimistic, setOptimistic] = useState<LeadStatusId | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, startTransition] = useTransition();

  const shown = optimistic ?? value;

  async function onChange(next: LeadStatusId) {
    const previous = shown;
    setOptimistic(next);
    setFailed(false);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      startTransition(() => {
        router.refresh();
        setOptimistic(null);
      });
    } catch {
      setOptimistic(previous === next ? null : previous);
      setFailed(true);
    }
  }

  return (
    <span className="status-select-wrap">
      <Select
        className="select-inline"
        value={shown}
        disabled={saving}
        busy={saving}
        invalid={failed}
        ariaLabel={ariaLabel}
        options={statuses.map((id) => ({ value: id, label: labels[id] }))}
        onChange={(next) => void onChange(next as LeadStatusId)}
      />
      {failed && failedLabel ? (
        <span className="status-select-error" role="alert">
          {failedLabel}
        </span>
      ) : null}
    </span>
  );
}
