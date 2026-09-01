"use client";

import { useRouter } from "next/navigation";
import type { LeadStatusId } from "@/lib/ui";

export function LeadStatusSelect({
  leadId,
  value,
  labels,
  ariaLabel,
}: {
  leadId: string;
  value: LeadStatusId;
  labels: Record<LeadStatusId, string>;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const statuses = Object.keys(labels) as LeadStatusId[];

  async function onChange(status: string) {
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  return (
    <select
      className="status-select"
      value={value}
      onChange={(e) => void onChange(e.target.value)}
      aria-label={ariaLabel ?? "status"}
    >
      {statuses.map((id) => (
        <option key={id} value={id}>
          {labels[id]}
        </option>
      ))}
    </select>
  );
}
