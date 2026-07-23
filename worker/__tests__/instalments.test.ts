import { describe, expect, it } from "vitest";
import {
  instalmentExpectedDateStatus,
  isInstalmentExpectedDateField,
  isInstalmentReceivedField,
} from "../lib/instalments";

describe("instalments", () => {
  it("recognises expected-date and received field keys", () => {
    expect(isInstalmentExpectedDateField("installment_2_expected_date")).toBe(true);
    expect(isInstalmentReceivedField("installment_2_received")).toBe(true);
    expect(isInstalmentExpectedDateField("payment_status")).toBe(false);
  });

  it("marks expected date completed only when received", () => {
    expect(instalmentExpectedDateStatus("2026-03-01", "true")).toBe("completed");
    expect(instalmentExpectedDateStatus("2026-03-01", null)).toBe("in_progress");
  });
});
