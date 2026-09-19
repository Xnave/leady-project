/**
 * The reservations capability's collect list expressed as typed field specs.
 *
 * Core check-in/check-out become a single `date_range` (the span, with its
 * start < end rule, is now a field type rather than hand-written validation).
 * Configured fields become `enum` when the tenant supplied options, otherwise `text`.
 */
import { copyFor } from "@/lib/copy";
import type { FieldContext, FieldSpec } from "./fields";
import {
  RESERVATION_CORE_FIELDS,
  reservationVocab,
  type ReservationConfig,
} from "./reservation-config";

const [CHECK_IN, CHECK_OUT] = RESERVATION_CORE_FIELDS;

/**
 * Endpoint labels are the short confirmation-summary wording ("Check-in"), which
 * differs from the longer wording used when asking ("check-in date"). Both come
 * from the instance's vocabulary, so they follow the tenant's own words.
 */
function endpointLabel(config: ReservationConfig, key: string) {
  return {
    en: reservationVocab(config, "en").summaryLabels[key] ?? key,
    he: reservationVocab(config, "he").summaryLabels[key] ?? key,
  };
}

export function reservationFieldSpecs(config: ReservationConfig): FieldSpec[] {
  const specs: FieldSpec[] = [
    {
      id: "stay",
      type: "date_range",
      startId: CHECK_IN,
      endId: CHECK_OUT,
      endpointLabels: {
        [CHECK_IN]: endpointLabel(config, CHECK_IN),
        [CHECK_OUT]: endpointLabel(config, CHECK_OUT),
      },
    },
  ];

  for (const id of config.collect) {
    const label = config.fieldLabels?.[id];
    const labels = label ? { en: label, he: label } : undefined;
    const options = config.fieldOptions?.[id];
    if (options?.length) {
      specs.push({
        id,
        type: "enum",
        labels,
        options: options.map((o) => ({ id: o.id, label: o.label, max: o.maxGuests })),
      });
      continue;
    }
    specs.push({ id, type: "text", labels });
  }

  return specs;
}

export function reservationFieldContext(
  config: ReservationConfig,
  lang: "en" | "he",
  opts?: { now?: Date },
): FieldContext {
  return {
    lang,
    now: opts?.now,
    labelFallback: reservationVocab(config, lang).fieldLabels,
    askFallback: (spec, key) => {
      const chat = copyFor(lang).chat;
      const label =
        reservationVocab(config, lang).fieldLabels[key] ?? key.replaceAll("_", " ");
      const options = config.fieldOptions?.[key];
      if (options?.length) {
        return chat.askFieldWithOptions(label, options.map((o) => o.label).join(" · "));
      }
      return chat.request.askField(label);
    },
  };
}
