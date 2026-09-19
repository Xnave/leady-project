import type { LeadFields, TurnContext } from "./types";
import {
  parseReservationConfig,
  reservationEphemeralKeys,
  type ReservationConfig,
} from "./reservation-config";
import { reservationFieldContext, reservationFieldSpecs } from "./reservation-fields";
import {
  fieldGaps,
  isDateRangeValid,
  normalizeDateValue,
  toIsoDate,
} from "./fields";

export { toIsoDate };
import { instanceConfig } from "./instances";

export function reservationConfigFromCtx(ctx: TurnContext): ReservationConfig {
  return parseReservationConfig(instanceConfig(ctx, "reservations"));
}

export function isReservationCollectActive(fields: LeadFields): boolean {
  return String(fields.reservation_flow ?? "").trim() === "active";
}

export function reservationFieldGaps(
  fields: LeadFields,
  config: ReservationConfig,
): string[] {
  return fieldGaps(
    reservationFieldSpecs(config),
    fields,
    reservationFieldContext(config, "en"),
  );
}

export function reservationConfirmStatus(fields: LeadFields): string {
  return String(fields.reservation_confirm ?? "").trim();
}

/** Parse loose customer date wording into YYYY-MM-DD when possible. */
export function normalizeStayDate(raw: string, now: Date = new Date()): string | null {
  return normalizeDateValue(raw, now);
}

export function stayDatesValid(checkIn: string, checkOut: string): boolean {
  return isDateRangeValid(checkIn, checkOut);
}

/**
 * Strip ephemeral stay-reservation keys from a fields bag.
 * Clears RESERVATION_SESSION_FIELD_KEYS ∪ config.collect, minus durable CRM (name/phone/email).
 */
export function clearReservationSessionFields(
  fields: LeadFields,
  config?: ReservationConfig | null,
): LeadFields {
  const next = { ...fields };
  for (const key of reservationEphemeralKeys(config)) {
    delete next[key];
  }
  return next;
}

