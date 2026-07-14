import { describe, expect, it } from "vitest";
import {
  evaluatePocCompletion,
  isPocFieldValueFilled,
  mergePocValues,
  POC_CONFIRMATION_BLOCKER,
} from "../../worker/lib/poc-completion";

describe("poc completion", () => {
  it("treats vendor registration Pending as incomplete", () => {
    expect(isPocFieldValueFilled("vendor_registration_form", "Pending")).toBe(false);
    expect(isPocFieldValueFilled("vendor_registration_form", "Received")).toBe(true);
    expect(isPocFieldValueFilled("vendor_registration_form", "No Applicable")).toBe(true);
  });

  it("requires all ten fields before marking complete", () => {
    const partial = evaluatePocCompletion({
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
    });
    expect(partial.complete).toBe(false);
    expect(partial.filledCount).toBe(3);
    expect(partial.missing).toContain("bank_details");
  });

  it("marks complete only when every field is filled", () => {
    const complete = evaluatePocCompletion({
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
      bank_details: "ICICI Bank",
      gst_no: "27AAATT3454F1ZI",
      tan_no: "TAN123",
      pan_no: "PAN123",
      signing_authority_address: "Principal",
      courier_address: "Mumbai",
      vendor_registration_form: "No Applicable",
    });
    expect(complete.complete).toBe(true);
    expect(complete.missing).toEqual([]);
  });

  it("merges checklist values with requirements fallback", () => {
    expect(mergePocValues(
      { poc_name: "From checklist" },
      JSON.stringify({ poc_email: "from-form@example.com" }),
    )).toEqual({
      poc_name: "From checklist",
      poc_email: "from-form@example.com",
    });
  });

  it("uses the confirmation blocker copy requested by ops", () => {
    expect(POC_CONFIRMATION_BLOCKER).toBe("POC not filled, cannot confirm.");
  });
});
