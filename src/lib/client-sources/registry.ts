import { isProductionRuntime } from "@/lib/dev-auth-bypass";
import { createFakeConnector } from "./fake";
import { smartNpvConnector } from "./smartnpv";
import type { AnyClientConnector } from "./types";

/**
 * Every CRM we can pull clients from. Adding one = a connector file plus a
 * line here; the sync worker, tables and screens stay as they are.
 */
const CONNECTORS: AnyClientConnector[] = [smartNpvConnector];

/** Local/preview only: a fixed in-memory client list for trying the screens. */
const fakeConnector = createFakeConnector();

export function listConnectors(): AnyClientConnector[] {
  return isProductionRuntime() ? CONNECTORS : [...CONNECTORS, fakeConnector];
}

export function getConnector(kind: string): AnyClientConnector | null {
  return listConnectors().find((c) => c.kind === kind) ?? null;
}
