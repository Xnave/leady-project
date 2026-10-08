/**
 * Shared time_preference hours gate - used by booking save_fields and
 * datetime_text field normalize so policy/copy cannot drift.
 */
import { copyFor } from "@/lib/copy";
import type { NormalizeError } from "./fields/types";
import {
  checkBookableSlot,
  type BookableSlotResult,
  type VenueScheduleSegment,
} from "./venue-hours";

export function evaluateTimePreference(
  value: string,
  opts: {
    lang: "en" | "he";
    hoursLabel: string;
    schedule?: VenueScheduleSegment[];
    timeZone?: string;
    now?: Date;
  },
): BookableSlotResult {
  return checkBookableSlot({
    slotText: value,
    hoursLabel: opts.hoursLabel,
    schedule: opts.schedule,
    lang: opts.lang,
    timeZone: opts.timeZone,
    now: opts.now,
  });
}

export function timePreferenceNormalizeError(
  result: BookableSlotResult,
  lang: "en" | "he",
  hoursLabel: string,
): NormalizeError | null {
  if (result.status === "ok") return null;
  const chat = copyFor(lang).chat;
  switch (result.status) {
    case "outside_hours":
      return {
        ok: false,
        error: "outside_hours",
        reask: chat.askTimeOutsideHours(hoursLabel),
        hint: "Ask only for another day/time inside opening hours. Do not ask for other fields until this is saved.",
      };
    case "ambiguous_time":
      return {
        ok: false,
        error: "ambiguous_time",
        reask: chat.askTimeAmbiguous,
        hint: "Ask whether they meant morning or evening (or an exact HH:MM). Do not save time_preference yet.",
      };
    case "unclear_time":
      return {
        ok: false,
        error: "unclear_time",
        reask: chat.askTimeUnclear,
        hint: "Ask for a concrete day and clock time. Do not save time_preference yet.",
      };
    case "invalid_hours":
      return {
        ok: false,
        error: "invalid_hours",
        reask: chat.askTimeInvalidHours,
        hint: "Opening hours could not be checked. Ask for another day/time; do not invent availability.",
      };
  }
}
