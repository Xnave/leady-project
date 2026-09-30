import { redirect } from "next/navigation";

/** Handoffs and approvals live in Leads → Needs you; old /inbox links land there. */
export default function InboxPage() {
  redirect("/leads?tab=needs");
}
