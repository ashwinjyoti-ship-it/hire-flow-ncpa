import { describe, expect, it } from "vitest";
import {
  areFinancialsReadyForConfirmationLetterDelivery,
  CONFIRMATION_LETTER_REQUIRES_FINANCIALS_MESSAGE,
  COSTING_EMAIL_BLOCKER,
  hasInvalidPaymentBeforeCosting,
  isAdvancingConfirmationLetterDelivery,
  isConfirmationLetterDeliveryField,
  isCostingEmailSent,
  isPaymentGateSatisfied,
  isPaymentMarkedCompleted,
  isProformaSatisfiedForConfirmationLetter,
  PAYMENT_COMPLETED_BLOCKER,
  PAYMENT_REQUIRES_COSTING_MESSAGE,
} from "../lib/financial-sequence";

describe("financial sequence helpers", () => {
  it("treats only Yes as costing email sent", () => {
    expect(isCostingEmailSent("Yes")).toBe(true);
    expect(isCostingEmailSent("yes")).toBe(true);
    expect(isCostingEmailSent("No")).toBe(false);
    expect(isCostingEmailSent(null)).toBe(false);
    expect(isCostingEmailSent("")).toBe(false);
  });

  it("treats only Completed as payment marked complete", () => {
    expect(isPaymentMarkedCompleted("Completed")).toBe(true);
    expect(isPaymentMarkedCompleted("completed")).toBe(true);
    expect(isPaymentMarkedCompleted("Incomplete")).toBe(false);
    expect(isPaymentMarkedCompleted(null)).toBe(false);
  });

  it("requires costing before payment can satisfy the gate", () => {
    expect(isPaymentGateSatisfied("Yes", "Completed")).toBe(true);
    expect(isPaymentGateSatisfied("No", "Completed")).toBe(false);
    expect(isPaymentGateSatisfied("Yes", "Incomplete")).toBe(false);
    expect(isPaymentGateSatisfied(null, "Completed")).toBe(false);
  });

  it("detects the invalid Completed-without-costing sequence", () => {
    expect(hasInvalidPaymentBeforeCosting("No", "Completed")).toBe(true);
    expect(hasInvalidPaymentBeforeCosting("Yes", "Completed")).toBe(false);
    expect(hasInvalidPaymentBeforeCosting("No", "Incomplete")).toBe(false);
  });

  it("exports stable blocker copy used by lifecycle UI targets", () => {
    expect(COSTING_EMAIL_BLOCKER).toBe("Costing email must be sent.");
    expect(PAYMENT_COMPLETED_BLOCKER).toBe("Payment must be completed.");
    expect(PAYMENT_REQUIRES_COSTING_MESSAGE).toContain("Costing Email is Yes");
    expect(CONFIRMATION_LETTER_REQUIRES_FINANCIALS_MESSAGE).toContain("Couriered");
  });

  it("treats proforma Sent or Not Applicable as satisfied for letter delivery", () => {
    expect(isProformaSatisfiedForConfirmationLetter("Sent")).toBe(true);
    expect(isProformaSatisfiedForConfirmationLetter("Not Applicable")).toBe(true);
    expect(isProformaSatisfiedForConfirmationLetter("Not Sent")).toBe(false);
    expect(isProformaSatisfiedForConfirmationLetter(null)).toBe(false);
  });

  it("requires costing, proforma, and payment before Couriered / Signed", () => {
    expect(areFinancialsReadyForConfirmationLetterDelivery({
      costingEmail: "Yes",
      proformaInvoice: "Sent",
      paymentStatus: "Completed",
    })).toBe(true);
    expect(areFinancialsReadyForConfirmationLetterDelivery({
      costingEmail: "Yes",
      proformaInvoice: "Not Applicable",
      paymentStatus: "Completed",
    })).toBe(true);
    expect(areFinancialsReadyForConfirmationLetterDelivery({
      costingEmail: "No",
      proformaInvoice: "Sent",
      paymentStatus: "Completed",
    })).toBe(false);
    expect(areFinancialsReadyForConfirmationLetterDelivery({
      costingEmail: "Yes",
      proformaInvoice: "Not Sent",
      paymentStatus: "Completed",
    })).toBe(false);
    expect(areFinancialsReadyForConfirmationLetterDelivery({
      costingEmail: "Yes",
      proformaInvoice: "Sent",
      paymentStatus: "Incomplete",
    })).toBe(false);
  });

  it("only treats Couriered date and Signed Yes as delivery advances", () => {
    expect(isConfirmationLetterDeliveryField("confirmation_made")).toBe(false);
    expect(isConfirmationLetterDeliveryField("confirmation_couriered")).toBe(true);
    expect(isAdvancingConfirmationLetterDelivery("confirmation_couriered", "2026-07-18")).toBe(true);
    expect(isAdvancingConfirmationLetterDelivery("confirmation_couriered", null)).toBe(false);
    expect(isAdvancingConfirmationLetterDelivery("confirmation_signed_received", "Yes")).toBe(true);
    expect(isAdvancingConfirmationLetterDelivery("confirmation_signed_received", "No")).toBe(false);
    expect(isAdvancingConfirmationLetterDelivery("confirmation_made", "Yes")).toBe(false);
  });
});
