import { describe, expect, it } from "vitest";
import {
  getCurrentPendingInstalmentNumber,
  instalmentExpectedDateStatus,
  isInstalmentReceivedValue,
} from "./instalments";

describe("instalment helpers", () => {
  it("treats checkbox true as received", () => {
    expect(isInstalmentReceivedValue("true")).toBe(true);
    expect(isInstalmentReceivedValue("false")).toBe(false);
  });

  it("derives expected-date status from received checkbox", () => {
    expect(instalmentExpectedDateStatus("2026-03-01", null)).toBe("in_progress");
    expect(instalmentExpectedDateStatus("2026-03-01", "true")).toBe("completed");
    expect(instalmentExpectedDateStatus(null, null)).toBe("not_started");
  });

  it("returns the lowest due instalment that is not received", () => {
    const items = [
      { field_key: "installment_1_expected_date", value: "2026-01-01" },
      { field_key: "installment_1_received", value: "true" },
      { field_key: "installment_2_expected_date", value: "2026-02-01" },
      { field_key: "installment_2_received", value: null },
      { field_key: "installment_3_expected_date", value: "2026-08-01" },
      { field_key: "installment_3_received", value: null },
    ];
    expect(getCurrentPendingInstalmentNumber(items, "2026-07-23")).toBe(2);
  });
});
