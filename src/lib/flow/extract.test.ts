import { describe, expect, it } from "vitest";
import { assignBareReply, patternExtract } from "./extract";

describe("assignBareReply", () => {
  it("maps a first name when name is the next slot", () => {
    expect(assignBareReply("Nave", {}, ["name", "email"], [])).toEqual({
      name: "Nave",
    });
  });

  it("does not treat why/hello as a name", () => {
    expect(assignBareReply("Why?", {}, ["name"], [])).toEqual({});
    expect(assignBareReply("Hello", {}, ["name"], [])).toEqual({});
    expect(assignBareReply("שלום מה נשמע?", {}, ["name"], [])).toEqual({});
    expect(assignBareReply("חדש", {}, ["name"], [])).toEqual({});
  });

  it("picks email out of a mixed sentence", () => {
    expect(patternExtract("I'm Dana, dana@x.com", ["name", "email"]).email).toBe(
      "dana@x.com",
    );
  });
});
