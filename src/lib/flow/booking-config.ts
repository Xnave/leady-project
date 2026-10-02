/**
 * Booking instance configuration — what used to be the `venue*` and
 * `booking*Template` columns on Tenant, now the `config` JSON of a
 * `CapabilityInstance` with `capabilityId: "booking"`.
 */
import { DEFAULT_TZ } from "./clock";
import { instanceConfig } from "./instances";
import {
  nounFor,
  parseInstanceNouns,
  type InstanceNoun,
  type InstanceNounsByLang,
} from "./nouns";
import type { CapabilityInstanceSnapshot, TurnContext } from "./types";
import {
  normalizeVenueSchedule,
  parseVenueSchedule,
  type VenueScheduleSegment,
} from "./venue-hours";

export type BookingMessageTemplates = {
  request?: string;
  approved?: string;
  rejected?: string;
};

export type BookingConfig = {
  venueAddress: string;
  /** Human-readable hours for prompts / UI (source of truth for operators). */
  venueHours: string;
  /**
   * Normalized bookable windows derived from `venueHours` on save.
   * Gate checks this; free-text parse is only a fallback for legacy rows.
   */
  venueSchedule: VenueScheduleSegment[];
  /** IANA timezone for weekday / "today" math. Defaults to Asia/Jerusalem. */
  timezone: string;
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
  venueSchedule: [],
  timezone: DEFAULT_TZ,
  messageTemplates: {},
});

function str(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalStr(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

function timezoneOrDefault(raw: unknown): string {
  const t = str(raw);
  return t || DEFAULT_TZ;
}

export function parseBookingConfig(raw: unknown): BookingConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyBookingConfig();
  const o = raw as Record<string, unknown>;
  const templates =
    o.messageTemplates && typeof o.messageTemplates === "object"
      ? (o.messageTemplates as Record<string, unknown>)
      : {};
  const venueHours = str(o.venueHours);
  const stored = parseVenueSchedule(o.venueSchedule);
  return {
    venueAddress: str(o.venueAddress),
    venueHours,
    // Prefer persisted schedule; rebuild from the label when missing (legacy rows).
    venueSchedule: stored.length ? stored : normalizeVenueSchedule(venueHours),
    timezone: timezoneOrDefault(o.timezone),
    messageTemplates: {
      request: optionalStr(templates.request),
      approved: optionalStr(templates.approved),
      rejected: optionalStr(templates.rejected),
    },
    nouns: parseInstanceNouns(o.nouns),
  };
}

/** Build booking config from operator fields, always refreshing the schedule. */
export function bookingConfigFromFields(fields: {
  venueAddress?: string;
  venueHours?: string;
  timezone?: string;
  messageTemplates?: BookingMessageTemplates;
  nouns?: InstanceNounsByLang;
}): BookingConfig {
  const venueHours = str(fields.venueHours);
  return {
    venueAddress: str(fields.venueAddress),
    venueHours,
    venueSchedule: normalizeVenueSchedule(venueHours),
    timezone: timezoneOrDefault(fields.timezone),
    messageTemplates: fields.messageTemplates ?? {},
    nouns: fields.nouns,
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
  const merged = { ...emptyBookingConfig(), ...config };
  if (!merged.timezone) merged.timezone = DEFAULT_TZ;
  if (!config.venueSchedule && merged.venueHours) {
    merged.venueSchedule = normalizeVenueSchedule(merged.venueHours);
  }
  return {
    id: "booking-instance",
    capabilityId: BOOKING_CAPABILITY_ID,
    kind: "visit",
    enabled: true,
    config: merged,
  };
}

/** Opening hours phrase the agent must keep visits inside, when configured. */
export function venueHoursFromCtx(ctx: TurnContext): string {
  return bookingConfigFromCtx(ctx).venueHours;
}

/** Structured schedule for the deterministic hours gate. */
export function venueScheduleFromCtx(ctx: TurnContext): VenueScheduleSegment[] {
  return bookingConfigFromCtx(ctx).venueSchedule;
}

/** Venue IANA timezone for slot weekday math. */
export function venueTimezoneFromCtx(ctx: TurnContext): string {
  return bookingConfigFromCtx(ctx).timezone || DEFAULT_TZ;
}
