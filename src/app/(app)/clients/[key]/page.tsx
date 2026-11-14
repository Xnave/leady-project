import { renderClients } from "@/components/clients/load";

export const dynamic = "force-dynamic";

/** One client open beside the list (desktop) or on its own (mobile). */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  return renderClients(await searchParams, decodeURIComponent(key));
}
