/**
 * Financial sequence for confirmation gating.
 *
 * Order: Costing Email = Yes → Payment Status = Completed.
 * Proforma and instalment tracking are operational follow-ups and do not gate
 * confirmation. A Payment Status of Completed while Costing Email is still No
 * is an invalid sequence and must not clear the payment blocker.
 */

export const COSTING_EMAIL_BLOCKER = "Costing email must be sent.";
export const PAYMENT_COMPLETED_BLOCKER = "Payment must be completed.";

export const PAYMENT_REQUIRES_COSTING_MESSAGE =
  "Payment cannot be marked Completed until Costing Email is Yes.";

export function isCostingEmailSent(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "yes";
}

export function isPaymentMarkedCompleted(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "completed";
}

/**
 * Payment satisfies the confirmation gate only when costing email has already
 * been sent. Completed-without-costing is treated as unsatisfied.
 */
export function isPaymentGateSatisfied(
  costingEmail: string | null | undefined,
  paymentStatus: string | null | undefined,
): boolean {
  return isCostingEmailSent(costingEmail) && isPaymentMarkedCompleted(paymentStatus);
}

/** Stored payment Completed while costing email is not Yes — needs heal. */
export function hasInvalidPaymentBeforeCosting(
  costingEmail: string | null | undefined,
  paymentStatus: string | null | undefined,
): boolean {
  return isPaymentMarkedCompleted(paymentStatus) && !isCostingEmailSent(costingEmail);
}
