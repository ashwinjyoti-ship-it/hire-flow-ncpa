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

  it("uses the agreed Financials dropdown vocabularies", () => {
    const costing = financials.find((d) => d.field_key === "costing_email");
    expect(costing?.options).toEqual(["No", "Yes"]);
    expect(costing?.default_value).toBe("No");

    const proforma = financials.find((d) => d.field_key === "proforma_invoice");
    expect(proforma?.options).toEqual(["Not Sent", "Sent", "Not Applicable"]);
    expect(proforma?.default_value).toBe("Not Sent");

    const payment = financials.find((d) => d.field_key === "payment_status");
    expect(payment?.options).toEqual(["Incomplete", "Completed"]);
    expect(payment?.default_value).toBe("Incomplete");
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

describe("operations action checklist", () => {
  const operations = CHECKLIST_DEFINITIONS.filter((definition) => definition.module === "operations");
  const keys = operations.map((definition) => definition.field_key);

  it("keeps event identity computed and removes duplicated form data", () => {
    for (const key of ["event_name", "event_dates", "venue", "event_type"]) {
      expect(operations.find((definition) => definition.field_key === key)?.is_computed).toBe(true);
    }
    for (const key of [
      "poc_name",
      "exec_sound_light",
      "no_of_crew_cards",
      "house_seats",
      "licenses_status",
      "decorator_name",
      "caterer_name",
      "catering_details",
    ]) {
      expect(keys).not.toContain(key);
    }
  });

  it("ends with post-event closure actions", () => {
    expect(operations.at(-1)?.field_key).toBe("final_closure_notes");
    expect(operations.at(-1)?.section).toBe("Post-Event Closure");
  });
});
