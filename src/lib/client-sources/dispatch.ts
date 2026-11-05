import { inngest } from "@/inngest/client";
import { isProductionRuntime } from "@/lib/dev-auth-bypass";
import { runSourceSyncInline, type SyncMode } from "./store";

export const CLIENT_SOURCE_SYNC_EVENT = "client-sources/sync.requested";

export type ClientSourceSyncEvent = {
  name: typeof CLIENT_SOURCE_SYNC_EVENT;
  data: { tenantId: string; sourceId: string; mode: SyncMode };
};

export function syncEvent(tenantId: string, sourceId: string, mode: SyncMode): ClientSourceSyncEvent {
  return { name: CLIENT_SOURCE_SYNC_EVENT, data: { tenantId, sourceId, mode } };
}

/**
 * Queue a sync on Inngest. Locally, where no Inngest dev server usually runs,
 * fall back to syncing in this request so the screens still work.
 */
export async function requestSourceSync(
  tenantId: string,
  sourceId: string,
  mode: SyncMode,
): Promise<{ queued: true } | { queued: false; inline: true }> {
  try {
    await inngest.send(syncEvent(tenantId, sourceId, mode));
    return { queued: true };
  } catch (err) {
    if (isProductionRuntime()) throw err;
    console.warn(JSON.stringify({ msg: "client_sources.sync_inline_fallback", tenantId, sourceId }));
    await runSourceSyncInline(tenantId, sourceId, mode);
    return { queued: false, inline: true };
  }
}
