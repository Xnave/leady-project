import { describe, expect, it } from "vitest";
import {
  parseReservationConfig,
  renderReservationTemplate,
  reservationCollectFields,
  reservationEphemeralKeys,
  reservationFieldLabel,
  reservationVocab,
} from "./reservation-config";
import {
  assertSafeProbeUrl,
  classifyProbeBody,
  buildProbeUrl,
} from "./availability-link-probe";
import { isReservationStillRelevant } from "./reservation-relevance";
import {
  clearReservationSessionFields,
  normalizeStayDate,
  reservationFieldGaps,
  stayDatesValid,
} from "./reservation-collect";
import { flowForCapabilities, isCapabilityId } from "./catalog";
import { getCapability } from "./registry";
import { ensureFlowRegistry } from "./capabilities";
import { copyFor } from "@/lib/copy";

describe("reservation-config", () => {
  it("defaults collect without occasion/price", () => {
    const cfg = parseReservationConfig({});
    expect(cfg.collect).toEqual(["guests", "name", "phone"]);
    expect(cfg.availability.kind).toBe("none");
    expect(reservationCollectFields(cfg)).toEqual([
      "check_in",
      "check_out",
      "guests",
      "name",
      "phone",
    ]);
  });

  it("ephemeral keys include custom collect minus CRM", () => {
    const cfg = parseReservationConfig({
      collect: ["guests", "name", "phone", "dogs"],
      fieldLabels: { dogs: "Number of dogs" },
    });
    const keys = reservationEphemeralKeys(cfg);
    expect(keys).toContain("check_in");
    expect(keys).toContain("dogs");
    expect(keys).toContain("guests");
    expect(keys).not.toContain("name");
    expect(keys).not.toContain("phone");
    const cleared = clearReservationSessionFields(
      {
        name: "Ada",
        phone: "050",
        dogs: "2",
        guests: "4",
        check_in: "2026-10-01",
        reservation_flow: "active",
      },
      cfg,
    );
    expect(cleared.name).toBe("Ada");
    expect(cleared.phone).toBe("050");
    expect(cleared.dogs).toBeUndefined();
    expect(cleared.guests).toBeUndefined();
    expect(cleared.check_in).toBeUndefined();
    expect(cleared.reservation_flow).toBeUndefined();
    expect(reservationFieldLabel("dogs", cfg)).toBe("Number of dogs");
  });

  it("parses link_probe + field options + policies from config", () => {
    const cfg = parseReservationConfig({
      collect: ["guests", "unit", "name"],
      fieldOptions: {
        unit: [{ id: "villa", label: "Villa", maxGuests: 20 }],
      },
      policies: [{ id: "party", trigger: "מסיבה", reply: "לא ניתן לערוך מסיבות." }],
      availability: {
        kind: "link_probe",
        linkProbe: {
          urlTemplate:
            "https://app.b-on.co.il/online/order-v2/{{propertySlug}}?dateFrom={{checkIn}}&dateTo={{checkOut}}",
          vars: { propertySlug: "plaza-boutique" },
          unavailableMatchers: [{ type: "contains", value: "תאריכים תפוסים" }],
        },
        onUnknown: "hitl",
      },
      bookingLinkTemplate:
        "https://app.b-on.co.il/online/order-v2/{{propertySlug}}?dateFrom={{checkIn}}&dateTo={{checkOut}}",
    });
    expect(cfg.collect).toContain("unit");
    expect(cfg.fieldOptions?.unit?.[0].id).toBe("villa");
    expect(cfg.policies?.[0].trigger).toBe("מסיבה");
    expect(cfg.availability.kind).toBe("link_probe");
    expect(cfg.availability.linkProbe?.unavailableMatchers[0].value).toBe("תאריכים תפוסים");
  });

  it("falls back when link_probe lacks matchers", () => {
    const cfg = parseReservationConfig({
      availability: {
        kind: "link_probe",
        linkProbe: { urlTemplate: "https://example.com/{{checkIn}}" },
        onUnknown: "hitl",
      },
    });
    expect(cfg.availability.kind).toBe("none");
  });
});

describe("availability-link-probe", () => {
  it("classifies unavailable from matcher text", () => {
    const html = "<html><body>תאריכים תפוסים — נסו תאריכים אחרים</body></html>";
    expect(
      classifyProbeBody(html, {
        unavailableMatchers: [{ type: "contains", value: "תאריכים תפוסים" }],
      }).status,
    ).toBe("unavailable");
  });

  it("classifies available when only availableMatchers hit", () => {
    const html = "<html><body>הזמינו עכשיו</body></html>";
    expect(
      classifyProbeBody(html, {
        unavailableMatchers: [{ type: "contains", value: "תאריכים תפוסים" }],
        availableMatchers: [{ type: "contains", value: "הזמינו עכשיו" }],
      }).status,
    ).toBe("available");
  });

  it("returns unknown when no matcher hits", () => {
    expect(
      classifyProbeBody("<html>hello</html>", {
        unavailableMatchers: [{ type: "contains", value: "תאריכים תפוסים" }],
      }).status,
    ).toBe("unknown");
  });

  it("builds URL from template vars", () => {
    const url = buildProbeUrl(
      {
        urlTemplate:
          "https://app.b-on.co.il/online/order-v2/{{propertySlug}}?dateFrom={{checkIn}}&dateTo={{checkOut}}",
        vars: { propertySlug: "plaza-boutique" },
        unavailableMatchers: [{ type: "contains", value: "x" }],
      },
      { checkIn: "2026-10-12", checkOut: "2026-10-16" },
    );
    expect(url).toContain("plaza-boutique");
    expect(url).toContain("dateFrom=2026-10-12");
    expect(url).toContain("dateTo=2026-10-16");
  });

  it("blocks private probe hosts", () => {
    expect(() => assertSafeProbeUrl("http://127.0.0.1/x")).toThrow(/probe_host_blocked/);
    expect(() => assertSafeProbeUrl("https://app.b-on.co.il/x")).not.toThrow();
  });

  it("renders booking link templates", () => {
    expect(
      renderReservationTemplate("https://x.test/{{checkIn}}/{{checkOut}}", {
        checkIn: "2026-01-01",
        checkOut: "2026-01-03",
      }),
    ).toBe("https://x.test/2026-01-01/2026-01-03");
  });
});

describe("reservation-collect + relevance", () => {
  it("gaps honor configured collect only", () => {
    const cfgA = parseReservationConfig({ collect: ["guests", "name"] });
    const cfgB = parseReservationConfig({ collect: ["guests", "unit", "name"] });
    expect(reservationFieldGaps({ check_in: "2026-10-01", check_out: "2026-10-03" }, cfgA)).toEqual([
      "guests",
      "name",
    ]);
    expect(
      reservationFieldGaps(
        { check_in: "2026-10-01", check_out: "2026-10-03", guests: "4", name: "A", unit: "villa" },
        cfgB,
      ),
    ).toEqual([]);
  });

  it("normalizes and validates stay dates", () => {
    expect(normalizeStayDate("12/10/2026")).toBe("2026-10-12");
    expect(stayDatesValid("2026-10-12", "2026-10-16")).toBe(true);
    expect(stayDatesValid("2026-10-16", "2026-10-12")).toBe(false);
  });

  it("relevance: pending always; approved until check-out day", () => {
    expect(
      isReservationStillRelevant(
        {
          status: "pending",
          checkInDate: "2026-01-01",
          checkOutDate: "2026-01-02",
        },
        new Date("2026-09-18"),
      ),
    ).toBe(true);
    expect(
      isReservationStillRelevant(
        {
          status: "approved",
          checkInDate: "2026-09-10",
          checkOutDate: "2026-09-12",
        },
        new Date("2026-09-18T12:00:00Z"),
      ),
    ).toBe(false);
    expect(
      isReservationStillRelevant(
        {
          status: "approved",
          checkInDate: "2026-09-17",
          checkOutDate: "2026-09-18",
        },
        new Date("2026-09-18T10:00:00"),
      ),
    ).toBe(true);
  });
});

describe("reservation i18n", () => {
  it("keeps copy generic and slots the instance noun in", () => {
    const en = copyFor("en").chat.request;
    const he = copyFor("he").chat.request;
    expect(en.confirmTitle("stay")).toMatch(/stay/i);
    expect(en.confirmTitle("rental")).toMatch(/rental/i);
    expect(he.confirmTitle("אירוח")).toMatch(/אירוח/);
    expect(en.askField("guests")).toContain("guests");
    expect(he.askField("אורחים")).toContain("אורחים");
    expect(en.defaultRequest({ noun: "rental", from: "2026-06-10", to: "2026-06-14", details: "" })).toMatch(
      /rental/,
    );
  });

  it("reads nouns from instance config, falling back to stay", () => {
    const stay = parseReservationConfig({});
    expect(reservationVocab(stay, "en").noun.singular).toBe("stay");
    expect(reservationVocab(stay, "he").noun.singular).toBe("אירוח");
    const rental = parseReservationConfig({
      nouns: {
        en: { singular: "rental", plural: "rentals" },
        he: { singular: "השכרה", plural: "השכרות" },
      },
    });
    expect(reservationVocab(rental, "en").noun.singular).toBe("rental");
    expect(reservationVocab(rental, "he").noun.singular).toBe("השכרה");
  });
});

describe("reservations capability registration", () => {
  it("registers reservations capability id", () => {
    ensureFlowRegistry();
    expect(isCapabilityId("reservations")).toBe(true);
    expect(getCapability("reservations")?.id).toBe("reservations");
    const flow = flowForCapabilities({ capabilities: ["reservations"] });
    const talk = flow.stages.talk;
    expect(talk.type).toBe("talk");
    if (talk.type === "talk") {
      expect(talk.capabilities).toContain("reservations");
      expect(talk.allowBook).toBe(false);
    }
  });
});
