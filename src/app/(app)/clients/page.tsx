import { renderClients } from "@/components/clients/load";

export const dynamic = "force-dynamic";

/** Owner/admin: CRM clients and their document collection. */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return renderClients(await searchParams, null);
}
