/** Stay reservation configuration — the `config` JSON of a reservations CapabilityInstance. */
import {
  nounFor,
  parseInstanceNouns,
  type InstanceNoun,
  type InstanceNounsByLang,
} from "./nouns";

export type ReservationFieldOption = {
  id: string;
  label: string;
  maxGuests?: number;
};

export type ReservationPolicy = {
  id: string;
  /** Natural-language trigger hint for the agent (e.g. "party", "מסיבה"). */
  trigger: string;
  reply: string;
};

export type LinkProbeMatcher = {
  type: "contains";
  value: string;
};

export type LinkProbeConfig = {
  urlTemplate: string;
  vars?: Record<string, string>;
  unavailableMatchers: LinkProbeMatcher[];
  availableMatchers?: LinkProbeMatcher[];
  timeoutMs?: number;
};

export type ReservationAvailabilityConfig = {
  kind: "link_probe" | "none";
  linkProbe?: LinkProbeConfig;
  onUnknown: "hitl" | "send_booking_link" | "ask_human";
};

export type ReservationSubmitMode = "hitl" | "send_link";

export type ReservationMessageTemplates = {
  request?: string;
  approved?: string;
  rejected?: string;
  /** Custom reply when submitMode is send_link. Use {{bookingUrl}} (and date tokens). */
  sendLink?: string;
};

export type ReservationConfig = {
  /** Extra fields beyond check_in / check_out. */
  collect: string[];
  /** What this business calls the request, per language ("stay", "rental", …). */
  nouns?: InstanceNounsByLang;
  /** Display labels for collect/core fields (operator language). */
  fieldLabels?: Record<string, string>;
  fieldOptions?: Record<string, ReservationFieldOption[]>;
  policies?: ReservationPolicy[];
  /** Optional; omit = agent must not state prices. */
  rates?: unknown;
  /**
   * How to finish a completed collect:
   * - `hitl` (default): create a pending Request for staff approval
   * - `send_link`: render bookingLinkTemplate and send it (no Request / no waiting_human)
   */
  submitMode: ReservationSubmitMode;
  bookingLinkTemplate?: string;
  availability: ReservationAvailabilityConfig;
  messageTemplates?: ReservationMessageTemplates;
};

/** Always collected for a span hold. */
export const RESERVATION_CORE_FIELDS = ["check_in", "check_out"] as const;

/**
 * Hospitality vocabulary as *data*, not as copy: the wording a villa gets when
 * it configures nothing. A dress shop overrides `nouns` and `fieldLabels` on its
 * instance and the same code produces rental wording.
 */
export type ReservationVocab = {
  noun: InstanceNoun;
  /** Long wording used when asking ("check-in date"). */
  fieldLabels: Record<string, string>;
  /** Short wording used in summaries ("Check-in"). */
  summaryLabels: Record<string, string>;
};

const DEFAULT_VOCAB: Record<"en" | "he", ReservationVocab> = {
  en: {
    noun: { singular: "stay", plural: "stays" },
    fieldLabels: {
      check_in: "check-in date",
      check_out: "check-out date",
      guests: "number of guests",
      unit: "unit / room type",
      name: "full name",
      phone: "phone",
      email: "email",
    },
    summaryLabels: { check_in: "Check-in", check_out: "Check-out" },
  },
  he: {
    noun: { singular: "אירוח", plural: "אירוחים" },
    fieldLabels: {
      check_in: "תאריך כניסה",
      check_out: "תאריך יציאה",
      guests: "מספר אורחים",
      unit: "יחידת אירוח",
      name: "שם מלא",
      phone: "טלפון",
      email: "אימייל",
    },
    summaryLabels: { check_in: "כניסה", check_out: "יציאה" },
  },
};

/** Configured vocabulary layered over the defaults. */
export function reservationVocab(
  config: ReservationConfig | null | undefined,
  lang: "en" | "he",
): ReservationVocab {
  const base = DEFAULT_VOCAB[lang];
  return {
    noun: nounFor(config?.nouns, lang, base.noun),
    fieldLabels: { ...base.fieldLabels, ...(config?.fieldLabels ?? {}) },
    summaryLabels: { ...base.summaryLabels, ...(config?.fieldLabels ?? {}) },
  };
}

/**
 * Contact identity that stays on Lead.fields across conversations.
 * Everything else collected for a stay is ephemeral (session / clearable).
 */
export const RESERVATION_DURABLE_CRM_KEYS = ["name", "phone", "email"] as const;

/** Built-in ephemeral session keys owned by the reservations capability. */
export const RESERVATION_SESSION_FIELD_KEYS = [
  "reservation_flow",
  "reservation_confirm",
  "check_in",
  "check_out",
  "guests",
  "unit",
  "staff_date_offer",
  "availability_status",
  "availability_url",
] as const;

export const DEFAULT_RESERVATION_COLLECT = ["guests", "name", "phone"] as const;

/** Suggested optional collect chips in onboard. */
export const RESERVATION_COLLECT_PRESETS = [
  "guests",
  "unit",
  "phone",
  "email",
  "name",
] as const;

export const emptyReservationConfig = (): ReservationConfig => ({
  collect: [...DEFAULT_RESERVATION_COLLECT],
  submitMode: "hitl",
  availability: { kind: "none", onUnknown: "hitl" },
});

export function isReservationDurableCrmKey(key: string): boolean {
  return (RESERVATION_DURABLE_CRM_KEYS as readonly string[]).includes(key);
}

/** Session / clearable keys: built-ins ∪ configured collect, minus durable CRM. */
export function reservationEphemeralKeys(config?: ReservationConfig | null): string[] {
  const collect = config?.collect ?? [];
  return [
    ...new Set([
      ...(RESERVATION_SESSION_FIELD_KEYS as readonly string[]),
      ...collect.filter((k) => !isReservationDurableCrmKey(k)),
    ]),
  ];
}

export function isReservationEphemeralKey(
  key: string,
  config?: ReservationConfig | null,
): boolean {
  return reservationEphemeralKeys(config).includes(key);
}

/** Label for a field: tenant fieldLabels → caller fallback → raw id. */
export function reservationFieldLabel(
  fieldId: string,
  config: ReservationConfig | null | undefined,
  fallbackLabels?: Record<string, string>,
): string {
  const fromConfig = config?.fieldLabels?.[fieldId]?.trim();
  if (fromConfig) return fromConfig;
  const fromFallback = fallbackLabels?.[fieldId]?.trim();
  if (fromFallback) return fromFallback;
  return fieldId.replaceAll("_", " ");
}

function isMatcher(raw: unknown): raw is LinkProbeMatcher {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as Record<string, unknown>;
  return m.type === "contains" && typeof m.value === "string" && m.value.trim().length > 0;
}

function parseLinkProbe(raw: unknown): LinkProbeConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.urlTemplate !== "string" || !o.urlTemplate.trim()) return undefined;
  const unavailable = Array.isArray(o.unavailableMatchers)
    ? o.unavailableMatchers.filter(isMatcher)
    : [];
  if (unavailable.length === 0) return undefined;
  const available = Array.isArray(o.availableMatchers)
    ? o.availableMatchers.filter(isMatcher)
    : undefined;
  const vars =
    o.vars && typeof o.vars === "object" && !Array.isArray(o.vars)
      ? Object.fromEntries(
          Object.entries(o.vars as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        )
      : undefined;
  return {
    urlTemplate: o.urlTemplate.trim(),
    vars,
    unavailableMatchers: unavailable,
    availableMatchers: available?.length ? available : undefined,
    timeoutMs:
      typeof o.timeoutMs === "number" && o.timeoutMs > 0 ? Math.min(o.timeoutMs, 30_000) : undefined,
  };
}

function sanitizeFieldKey(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) return null;
  if (key === "check_in" || key === "check_out") return null;
  return key;
}

/** Parse and sanitize tenant JSON into a usable ReservationConfig. */
export function parseReservationConfig(raw: unknown): ReservationConfig {
  const base = emptyReservationConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;

  const collect = Array.isArray(o.collect)
    ? [
        ...new Set(
          o.collect
            .filter((x): x is string => typeof x === "string")
            .map((x) => sanitizeFieldKey(x))
            .filter((x): x is string => Boolean(x)),
        ),
      ]
    : [...DEFAULT_RESERVATION_COLLECT];

  const fieldLabels: Record<string, string> = {};
  if (o.fieldLabels && typeof o.fieldLabels === "object" && !Array.isArray(o.fieldLabels)) {
    for (const [key, label] of Object.entries(o.fieldLabels as Record<string, unknown>)) {
      const k =
        sanitizeFieldKey(key) ??
        (key === "check_in" || key === "check_out" ? key : null);
      if (!k || typeof label !== "string" || !label.trim()) continue;
      fieldLabels[k] = label.trim();
    }
  }

  const fieldOptions: Record<string, ReservationFieldOption[]> = {};
  if (o.fieldOptions && typeof o.fieldOptions === "object" && !Array.isArray(o.fieldOptions)) {
    for (const [key, list] of Object.entries(o.fieldOptions as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const opts = list
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          id: String(item.id ?? "").trim(),
          label: String(item.label ?? item.id ?? "").trim(),
          maxGuests:
            typeof item.maxGuests === "number" && item.maxGuests > 0
              ? item.maxGuests
              : undefined,
        }))
        .filter((item) => item.id && item.label);
      if (opts.length) fieldOptions[key] = opts;
    }
  }

  const policies: ReservationPolicy[] = Array.isArray(o.policies)
    ? o.policies
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p) => ({
          id: String(p.id ?? "").trim() || "policy",
          trigger: String(p.trigger ?? "").trim(),
          reply: String(p.reply ?? "").trim(),
        }))
        .filter((p) => p.trigger && p.reply)
    : [];

  let availability: ReservationAvailabilityConfig = { kind: "none", onUnknown: "hitl" };
  if (o.availability && typeof o.availability === "object") {
    const a = o.availability as Record<string, unknown>;
    const onUnknown =
      a.onUnknown === "send_booking_link" || a.onUnknown === "ask_human" || a.onUnknown === "hitl"
        ? a.onUnknown
        : "hitl";
    if (a.kind === "link_probe") {
      const linkProbe = parseLinkProbe(a.linkProbe);
      availability = linkProbe
        ? { kind: "link_probe", linkProbe, onUnknown }
        : { kind: "none", onUnknown };
    } else {
      availability = { kind: "none", onUnknown };
    }
  }

  const mt =
    o.messageTemplates && typeof o.messageTemplates === "object"
      ? (o.messageTemplates as Record<string, unknown>)
      : null;
  const messageTemplates = mt
    ? {
        request: typeof mt.request === "string" ? String(mt.request) : undefined,
        approved: typeof mt.approved === "string" ? String(mt.approved) : undefined,
        rejected: typeof mt.rejected === "string" ? String(mt.rejected) : undefined,
        sendLink: typeof mt.sendLink === "string" ? String(mt.sendLink) : undefined,
      }
    : undefined;

  const bookingLinkTemplate =
    typeof o.bookingLinkTemplate === "string" && o.bookingLinkTemplate.trim()
      ? o.bookingLinkTemplate.trim()
      : undefined;

  // send_link requires a template so we never drop the customer with no next step.
  const submitMode: ReservationSubmitMode =
    o.submitMode === "send_link" && bookingLinkTemplate ? "send_link" : "hitl";

  return {
    collect: collect.length ? collect : [...DEFAULT_RESERVATION_COLLECT],
    nouns: parseInstanceNouns(o.nouns),
    fieldLabels: Object.keys(fieldLabels).length ? fieldLabels : undefined,
    fieldOptions: Object.keys(fieldOptions).length ? fieldOptions : undefined,
    policies: policies.length ? policies : undefined,
    rates: "rates" in o ? o.rates : undefined,
    submitMode,
    bookingLinkTemplate,
    availability,
    messageTemplates,
  };
}

/** All fields the agent should collect for a stay (core + configured). */
export function reservationCollectFields(config: ReservationConfig): string[] {
  return [...RESERVATION_CORE_FIELDS, ...config.collect];
}

export function renderReservationTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

export function reservationTemplateVars(opts: {
  checkIn: string;
  checkOut: string;
  name?: string;
  phone?: string;
  email?: string;
  guests?: string;
  unit?: string;
  business?: string;
  note?: string;
  bookingUrl?: string;
  details?: Record<string, string>;
  configVars?: Record<string, string>;
}): Record<string, string> {
  return {
    checkIn: opts.checkIn,
    checkOut: opts.checkOut,
    dateFrom: opts.checkIn,
    dateTo: opts.checkOut,
    name: opts.name ?? "",
    phone: opts.phone ?? "",
    email: opts.email ?? "",
    guests: opts.guests ?? "",
    unit: opts.unit ?? "",
    business: opts.business ?? "",
    note: opts.note ?? "",
    bookingUrl: opts.bookingUrl ?? "",
    ...(opts.configVars ?? {}),
    ...(opts.details ?? {}),
  };
}
