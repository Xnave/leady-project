import { describe, expect, it } from "vitest";
import {
  askField,
  confirmLines,
  describeFields,
  fieldGaps,
  fieldKeys,
  fieldLabel,
  isComplete,
  normalizeDateValue,
  normalizeField,
  normalizeFields,
  specForKey,
} from "./index";
import type { FieldContext, FieldSpec } from "./types";

const en: FieldContext = { lang: "en" };
const he: FieldContext = { lang: "he" };

/** A villa stay: the reservations vertical expressed as config. */
const staySpecs: FieldSpec[] = [
  {
    id: "stay",
    type: "date_range",
    startId: "check_in",
    endId: "check_out",
    endpointLabels: {
      check_in: { en: "check-in date" },
      check_out: { en: "check-out date" },
    },
  },
  { id: "guests", type: "number", min: 1, max: 12, labels: { en: "number of guests" } },
  {
    id: "unit",
    type: "enum",
    labels: { en: "unit" },
    options: [
      { id: "villa_a", label: "Villa A", max: 6 },
      { id: "villa_b", label: "Villa B", max: 12 },
    ],
  },
  { id: "phone", type: "phone", labels: { en: "phone" } },
];

/** A barber: a point in time plus a service. Same code, different config. */
const barberSpecs: FieldSpec[] = [
  { id: "time_preference", type: "datetime_text", withinBusinessHours: true },
  { id: "name", type: "text", satisfy: "full_name", labels: { en: "name" } },
  {
    id: "service",
    type: "enum",
    labels: { en: "service" },
    options: [
      { id: "cut", label: "Haircut" },
      { id: "beard", label: "Beard trim" },
    ],
  },
];

/** A wedding dress rental: a span plus an item and a size. */
const rentalSpecs: FieldSpec[] = [
  {
    id: "rental_window",
    type: "date_range",
    startId: "pickup_date",
    endId: "return_date",
    endpointLabels: {
      pickup_date: { en: "pickup date" },
      return_date: { en: "return date" },
    },
  },
  {
    id: "dress",
    type: "enum",
    labels: { en: "dress" },
    options: [{ id: "aurora", label: "Aurora" }],
  },
  { id: "size", type: "text", labels: { en: "size" } },
  { id: "email", type: "email", labels: { en: "email" } },
];

describe("key ownership", () => {
  it("date_range owns two keys; scalars own one", () => {
    expect(fieldKeys(staySpecs)).toEqual([
      "check_in",
      "check_out",
      "guests",
      "unit",
      "phone",
    ]);
    expect(describeFields(barberSpecs)).toBe("time_preference, name, service");
  });

  it("resolves the owning spec for an endpoint key", () => {
    expect(specForKey(staySpecs, "check_out")?.id).toBe("stay");
    expect(specForKey(staySpecs, "nope")).toBeUndefined();
  });
});

describe("gaps", () => {
  it("lists missing keys in spec order", () => {
    expect(fieldGaps(staySpecs, {}, en)).toEqual([
      "check_in",
      "check_out",
      "guests",
      "unit",
      "phone",
    ]);
  });

  it("treats a non-ISO date as a gap", () => {
    const gaps = fieldGaps(staySpecs, { check_in: "next week", check_out: "2026-02-10" }, en);
    expect(gaps).toContain("check_in");
    expect(gaps).not.toContain("check_out");
  });

  it("re-asks the end when the span is inverted", () => {
    const gaps = fieldGaps(
      staySpecs,
      { check_in: "2026-02-10", check_out: "2026-02-08", guests: "2", unit: "villa_a", phone: "0521234567" },
      en,
    );
    expect(gaps).toEqual(["check_out"]);
  });

  it("accepts a valid span", () => {
    expect(
      isComplete(
        staySpecs,
        {
          check_in: "2026-02-08",
          check_out: "2026-02-10",
          guests: "2",
          unit: "villa_a",
          phone: "0521234567",
        },
        en,
      ),
    ).toBe(true);
  });

  it("full_name satisfaction rejects a single token until the agent verifies it", () => {
    expect(fieldGaps(barberSpecs, { name: "Dana" }, en)).toContain("name");
    expect(
      fieldGaps(barberSpecs, { name: "Dana", name_collected_by_agent: "1" }, en),
    ).not.toContain("name");
    expect(fieldGaps(barberSpecs, { name: "Dana Cohen" }, en)).not.toContain("name");
  });
});

describe("normalize", () => {
  it("coerces loose date wording to ISO", () => {
    expect(normalizeField(staySpecs, "check_in", "2026-02-08", en)).toEqual({
      ok: true,
      value: "2026-02-08",
    });
    expect(normalizeField(staySpecs, "check_in", "8/2/2026", en)).toEqual({
      ok: true,
      value: "2026-02-08",
    });
    const now = new Date("2026-02-08T09:00:00Z");
    expect(normalizeDateValue("tomorrow", now)).toBe("2026-02-09");
    expect(normalizeDateValue("מחר", now)).toBe("2026-02-09");
    expect(normalizeField(staySpecs, "check_in", "sometime soon", en).ok).toBe(false);
  });

  it("maps enum labels onto ids and passes unknown values through", () => {
    expect(normalizeField(staySpecs, "unit", "Villa B", en)).toEqual({
      ok: true,
      value: "villa_b",
    });
    expect(normalizeField(staySpecs, "unit", "villa_a", en)).toEqual({
      ok: true,
      value: "villa_a",
    });
    expect(normalizeField(staySpecs, "unit", "the treehouse", en)).toEqual({
      ok: true,
      value: "the treehouse",
    });
  });

  it("enforces number bounds and extracts the digits", () => {
    expect(normalizeField(staySpecs, "guests", "4 people", en)).toEqual({
      ok: true,
      value: "4",
    });
    const tooMany = normalizeField(staySpecs, "guests", "40", en);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toBe("above_max");
    const tooFew = normalizeField(staySpecs, "guests", "0", en);
    if (!tooFew.ok) expect(tooFew.error).toBe("below_min");
  });

  it("rejects malformed phone and email, and surfaces a re-ask for email", () => {
    const phone = normalizeField(staySpecs, "phone", "hello", en);
    expect(phone.ok).toBe(false);
    if (!phone.ok) expect(phone.error).toBe("invalid_phone");
    expect(normalizeField(staySpecs, "phone", "052-123-4567", en).ok).toBe(true);

    const email = normalizeField(rentalSpecs, "email", "nave@", en);
    expect(email.ok).toBe(false);
    if (!email.ok) {
      expect(email.error).toBe("invalid_email");
      expect(email.reask).toBeTruthy();
    }
    expect(normalizeField(rentalSpecs, "email", "nave@example.com", en).ok).toBe(true);
  });

  it("trusts the deduced channel phone even when it fails the shape test", () => {
    const fctx: FieldContext = { lang: "en", deducedPhone: "ig-user-1" };
    expect(normalizeField(staySpecs, "phone", "ig-user-1", fctx).ok).toBe(true);
  });

  it("gates datetime_text on business hours only when configured", () => {
    const gated: FieldContext = { lang: "en", businessHours: "Sun-Thu 09:00-19:00" };
    const late = normalizeField(barberSpecs, "time_preference", "Thursday 23:00", gated);
    expect(late.ok).toBe(false);
    if (!late.ok) {
      expect(late.error).toBe("outside_hours");
      expect(late.reask).toBeTruthy();
    }
    expect(normalizeField(barberSpecs, "time_preference", "Thursday 10:00", gated).ok).toBe(
      true,
    );
    // No hours configured → no gate.
    expect(normalizeField(barberSpecs, "time_preference", "Thursday 23:00", en).ok).toBe(true);
  });

  it("normalizeFields keeps the first failure and drops unknown keys", () => {
    const { values, failure } = normalizeFields(
      staySpecs,
      { check_in: "2026-02-08", guests: "nonsense", surprise: "x" },
      en,
    );
    expect(values.check_in).toBe("2026-02-08");
    expect(values).not.toHaveProperty("surprise");
    expect(failure?.key).toBe("guests");
  });

  it("normalizeFields stores an explicit clear as empty string", () => {
    const { values } = normalizeFields(staySpecs, { guests: "" }, en);
    expect(values.guests).toBe("");
  });
});

describe("labels and confirmation", () => {
  it("prefers spec labels, then a caller fallback, then the humanised id", () => {
    expect(fieldLabel(staySpecs, "check_in", en)).toBe("check-in date");
    expect(fieldLabel(staySpecs, "guests", en)).toBe("number of guests");
    expect(
      fieldLabel(rentalSpecs, "size", { lang: "he", labelFallback: { size: "מידה" } }),
    ).toBe("מידה");
    expect(fieldLabel(rentalSpecs, "size", he)).toBe("size");
    expect(fieldLabel(staySpecs, "unknown_key", en)).toBe("unknown key");
  });

  it("renders confirmation lines in spec order, skipping blanks", () => {
    const lines = confirmLines(
      staySpecs,
      {
        check_in: "2026-02-08",
        check_out: "2026-02-10",
        unit: "villa_b",
        phone: "0521234567",
      },
      en,
    );
    expect(lines).toEqual([
      { label: "check-in date", value: "2026-02-08" },
      { label: "check-out date", value: "2026-02-10" },
      { label: "unit", value: "Villa B" },
      { label: "phone", value: "052-123-4567" },
    ]);
  });
});

describe("asks", () => {
  it("uses an operator-supplied prompt when present", () => {
    const specs: FieldSpec[] = [
      { id: "size", type: "text", prompts: { en: "Which dress size do you wear?" } },
    ];
    expect(askField(specs, "size", en)).toBe("Which dress size do you wear?");
  });

  it("lists options for an enum without a custom prompt", () => {
    const ask = askField(staySpecs, "unit", en) ?? "";
    expect(ask).toContain("Villa A");
    expect(ask).toContain("Villa B");
  });

  it("lets a capability supply canned copy before the generic ask", () => {
    const fctx: FieldContext = {
      lang: "en",
      askFallback: (_spec, key) => (key === "guests" ? "How many guests?" : undefined),
    };
    expect(askField(staySpecs, "guests", fctx)).toBe("How many guests?");
    expect(askField(staySpecs, "phone", fctx)).not.toBe("How many guests?");
  });

  it("includes business hours in a datetime_text ask", () => {
    const ask =
      askField(barberSpecs, "time_preference", {
        lang: "en",
        businessHours: "Sun-Thu 09:00-19:00",
      }) ?? "";
    expect(ask).toContain("09:00-19:00");
  });

  it("offers the deduced phone for confirmation", () => {
    const ask =
      askField(staySpecs, "phone", { lang: "en", deducedPhone: "0521234567" }) ?? "";
    expect(ask).toContain("052-123-4567");
  });

  it("returns undefined for a key no spec owns", () => {
    expect(askField(staySpecs, "not_a_field", en)).toBeUndefined();
  });
});

describe("a new vertical is config only", () => {
  it("drives a dress rental through the same functions as a villa stay", () => {
    expect(fieldKeys(rentalSpecs)).toEqual([
      "pickup_date",
      "return_date",
      "dress",
      "size",
      "email",
    ]);
    const { values } = normalizeFields(
      rentalSpecs,
      {
        pickup_date: "10/6/2026",
        return_date: "2026-06-14",
        dress: "Aurora",
        size: "38",
        email: "bride@example.com",
      },
      en,
    );
    expect(values).toEqual({
      pickup_date: "2026-06-10",
      return_date: "2026-06-14",
      dress: "aurora",
      size: "38",
      email: "bride@example.com",
    });
    expect(isComplete(rentalSpecs, values, en)).toBe(true);
    expect(confirmLines(rentalSpecs, values, en)[0]).toEqual({
      label: "pickup date",
      value: "2026-06-10",
    });
  });
});
