import { describe, expect, it } from "vitest";
import {
  COSTING_EMAIL_BLOCKER,
  hasInvalidPaymentBeforeCosting,
  isCostingEmailSent,
  isPaymentGateSatisfied,
  isPaymentMarkedCompleted,
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
  });
});
