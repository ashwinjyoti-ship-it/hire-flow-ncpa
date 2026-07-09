import { describe, expect, it } from "vitest";
import { CHECKLIST_DEFINITIONS } from "../seed/checklist-definitions";

/**
 * Financials-section regression tests. The section was reworked:
 *  - amount_received and full_payment_received were removed,
 *  - payment_status was simplified to Awaiting / Received,
 *  - field order is Costing Email → Proforma Invoice → Instalment → Payment Status.
 */
describe("financials checklist definitions", () => {
  const financials = CHECKLIST_DEFINITIONS.filter((d) => d.section === "Financials");
  const fieldKeys = financials.map((d) => d.field_key);

  it("does not define amount_received or full_payment_received", () => {
    expect(fieldKeys).not.toContain("amount_received");
    expect(fieldKeys).not.toContain("full_payment_received");
  });

  it("simplifies payment_status to Awaiting / Received", () => {
    const ps = financials.find((d) => d.field_key === "payment_status");
    expect(ps?.options).toEqual(["Awaiting", "Received"]);
    expect(ps?.default_value).toBe("Awaiting");
  });

  it("keeps costing_email, proforma_invoice, instalment, and installment date fields", () => {
    for (const key of [
      "costing_email",
      "proforma_invoice",
      "instalment",
      "installment_1_expected_date",
      "installment_2_expected_date",
      "installment_3_expected_date",
      "installment_4_expected_date",
      "installment_5_expected_date",
    ]) {
      expect(fieldKeys).toContain(key);
    }
  });

  it("orders the leading financial fields: costing email, proforma, instalment, payment status", () => {
    const order = [
      "costing_email",
      "proforma_invoice",
      "instalment",
      "payment_status",
    ].map((k) => fieldKeys.indexOf(k));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
