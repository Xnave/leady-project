import { redirect } from "next/navigation";

/** Ops is hidden from the product UI; keep the route for staff bookmarks. */
export default function OpsPage() {
  redirect("/onboard");
}
