"use client";

import { useRouter } from "next/navigation";

export function DeleteDemoLead({
  leadId,
  label,
  confirmText,
}: {
  leadId: string;
  label: string;
  confirmText: string;
}) {
  const router = useRouter();
  async function onClick() {
    if (!confirm(confirmText)) return;
    const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }
  return (
    <button type="button" className="btn-ghost" onClick={() => void onClick()}>
      {label}
    </button>
  );
}
