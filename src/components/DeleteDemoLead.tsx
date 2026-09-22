"use client";

import { useRouter } from "next/navigation";

export function DeleteDemoLead({
  leadId,
  label,
  confirmText,
  redirectTo,
}: {
  leadId: string;
  label: string;
  confirmText: string;
  /** After delete, navigate here instead of only refreshing (e.g. leave a deleted lead detail). */
  redirectTo?: string;
}) {
  const router = useRouter();
  async function onClick() {
    if (!confirm(confirmText)) return;
    const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
    if (!res.ok) return;
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  }
  return (
    <button type="button" className="btn-icon" onClick={() => void onClick()} aria-label={label} title={label}>
      ×
    </button>
  );
}
