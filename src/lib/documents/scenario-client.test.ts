import { describe, expect, it } from "vitest";
import {
  MIXED_COUPLE_UUID,
  STATUS_ZERO_PROBE_UUID,
  clientMismatches,
  clientUuidFor,
  flowClientAction,
  flowStep,
  runStem,
  updateParams,
} from "../../../scripts/smartnpv-test-profiles";

const account = {
  bank_id: "4",
  branch_id: "22",
  account_number: "10001",
  owner_details: "בדיקה",
};

describe("scenario client check", () => {
  it("uses the client that was created with that borrower's code 0", () => {
    expect(clientUuidFor({ status_report_1: "0" })).toBe(STATUS_ZERO_PROBE_UUID);
    expect(clientUuidFor({ status_report_1: "2", status_report_2: "0" })).toBe(MIXED_COUPLE_UUID);
    expect(clientUuidFor({ status_report_1: "2" })).toBeNull();
  });

  it("prefixes a shared client with the profile sequence, the flow, and the update order", () => {
    expect(flowStep("employment-unknown")?.prefix).toBe("5_a1");
    expect(flowStep("salaried-one")?.prefix).toBe("1_a2");
    expect(flowStep("salaried-one-adds-borrower")?.prefix).toBe("1_a3");
    expect(flowStep("controlling-shareholder")?.prefix).toBe("4_a4");
    expect(flowStep("salaried-loans")).toMatchObject({ prefix: "6_a5", last: true });
    expect(flowStep("salaried-no-accounts")?.prefix).toBe("8_b1");
    expect(flowStep("salaried-two-accounts")?.prefix).toBe("7_b2");
    expect(flowStep("salaried-couple-loans")).toMatchObject({ prefix: "2_b3", last: true });
    expect(runStem("employment-unknown")).toBe("5_a1_employment-unknown");
    expect(flowStep("code-5")).toMatchObject({ prefix: "10_c1", last: true });
    expect(runStem("code-5")).toBe("10_c1_code-5");
    expect(runStem("self-employed")).toBe("3_self-employed");
    expect(runStem("mixed-couple")).toBe("9_mixed-couple");
    expect(flowStep("self-employed")).toBeNull();
  });

  it("starts a flow client over when the previous profile is not what is stored", () => {
    expect(flowClientAction({ order: 1, saved: true, previousMatches: true })).toBe("recreate");
    expect(flowClientAction({ order: 2, saved: true, previousMatches: true })).toBe("update");
    expect(flowClientAction({ order: 3, saved: false, previousMatches: false })).toBe("recreate");
    expect(flowClientAction({ order: 3, saved: true, previousMatches: false })).toBe("recreate");
  });

  it("leaves code 0 out of the update", () => {
    expect(updateParams({ status_report_1: "0", status_report_2: "0", firstname_1: "בדיקה" })).toEqual({
      firstname_1: "בדיקה",
    });
    expect(updateParams({ status_report_1: "2", status_report_2: "" }).status_report_1).toBe("2");
  });

  it("accepts a fetched client that matches the profile and ignores row uuids", () => {
    const expected = {
      status_report_1: "0",
      id_2: "",
      banks_accounts: [account],
      liabilities: [],
    };
    expect(clientMismatches(expected, {
      status_report_1: "0",
      id_2: "",
      banks_accounts: [{ ...account, uuid: "row-1" }],
      liabilities: [],
    })).toEqual([]);
  });

  it("stops on a cleared employment code, an extra account, or a leftover loan", () => {
    const mismatches = clientMismatches(
      {
        status_report_1: "0",
        id_1: "000000018",
        banks_accounts: [account],
        liabilities: [],
      },
      {
        status_report_1: "",
        id_1: "111111111",
        banks_accounts: [account, { ...account, account_number: "10002" }],
        liabilities: [{ balance: "250000" }],
      },
    );
    expect(mismatches).toEqual([
      "status_report_1 is \"\", expected \"0\"",
      "id_1 differs",
      "banks_accounts 2, expected 1",
      "liabilities 1, expected 0",
    ]);
    expect(mismatches.join(" ")).not.toContain("111111111");
  });
});
