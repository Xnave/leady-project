/**
 * Booking instance configuration — what used to be the `venue*` and
 * `booking*Template` columns on Tenant, now the `config` JSON of a
 * `CapabilityInstance` with `capabilityId: "booking"`.
 */
import { instanceConfig } from "./instances";
import {
  nounFor,
  parseInstanceNouns,
  type InstanceNoun,
  type InstanceNounsByLang,
} from "./nouns";
import type { CapabilityInstanceSnapshot, TurnContext } from "./types";

export type BookingMessageTemplates = {
  request?: string;
  approved?: string;
  rejected?: string;
};

export type BookingConfig = {
  venueAddress: string;
  venueHours: string;
  messageTemplates: BookingMessageTemplates;
  /** What this business calls the request ("visit", "fitting", "appointment"). */
  nouns?: InstanceNounsByLang;
};

export const BOOKING_CAPABILITY_ID = "booking";

const DEFAULT_BOOKING_NOUN: Record<"en" | "he", InstanceNoun> = {
  en: { singular: "visit", plural: "visits" },
  he: { singular: "פגישה", plural: "פגישות" },
};

export const emptyBookingConfig = (): BookingConfig => ({
  venueAddress: "",
  venueHours: "",
  messageTemplates: {},
});

function str(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalStr(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

export function parseBookingConfig(raw: unknown): BookingConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyBookingConfig();
  const o = raw as Record<string, unknown>;
  const templates =
    o.messageTemplates && typeof o.messageTemplates === "object"
      ? (o.messageTemplates as Record<string, unknown>)
      : {};
  return {
    venueAddress: str(o.venueAddress),
    venueHours: str(o.venueHours),
    messageTemplates: {
      request: optionalStr(templates.request),
      approved: optionalStr(templates.approved),
      rejected: optionalStr(templates.rejected),
    },
    nouns: parseInstanceNouns(o.nouns),
  };
}

export function bookingConfigFromCtx(ctx: TurnContext): BookingConfig {
  return parseBookingConfig(instanceConfig(ctx, BOOKING_CAPABILITY_ID));
}

export function bookingNoun(
  config: BookingConfig | null | undefined,
  lang: "en" | "he",
): InstanceNoun {
  return nounFor(config?.nouns, lang, DEFAULT_BOOKING_NOUN[lang]);
}

/** A booking instance snapshot, for tests and for seeding a new tenant. */
export function bookingInstance(
  config: Partial<BookingConfig>,
): CapabilityInstanceSnapshot {
  return {
    id: "booking-instance",
    capabilityId: BOOKING_CAPABILITY_ID,
    kind: "visit",
    enabled: true,
    config: { ...emptyBookingConfig(), ...config },
  };
}

/** Opening hours the agent must keep visits inside, when configured. */
export function venueHoursFromCtx(ctx: TurnContext): string {
  return bookingConfigFromCtx(ctx).venueHours;
}
