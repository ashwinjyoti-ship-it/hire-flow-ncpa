/**
 * Financial sequence helpers.
 *
 * Lifecycle status → Confirmed still gates on Costing Email = Yes and Payment =
 * Completed (instalment does not gate that transition).
 *
 * Confirmation Letter delivery (Couriered / Signed Copy Received) additionally
 * requires Proforma Invoice = Sent or Not Applicable. Made may still be set
 * before financials are complete.
 *
 * A Payment Status of Completed while Costing Email is still No is an invalid
 * sequence and must not clear the payment blocker.
 */

export const COSTING_EMAIL_BLOCKER = "Costing email must be sent.";
export const PAYMENT_COMPLETED_BLOCKER = "Payment must be completed.";

export const PAYMENT_REQUIRES_COSTING_MESSAGE =
  "Payment cannot be marked Completed until Costing Email is Yes.";

export const CONFIRMATION_LETTER_REQUIRES_FINANCIALS_MESSAGE =
  "Confirmation letter Couriered and Signed Copy Received cannot be set until Costing Email is Yes, Proforma Invoice is Sent or Not Applicable, and Payment Status is Completed.";

export function isCostingEmailSent(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "yes";
}

export function isPaymentMarkedCompleted(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "completed";
}

/** Proforma is satisfied when Sent, or explicitly Not Applicable (left out). */
export function isProformaSatisfiedForConfirmationLetter(value: string | null | undefined): boolean {
  const normalised = (value ?? "").trim().toLowerCase();
  return normalised === "sent" || normalised === "not applicable";
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

export type ConfirmationLetterFinancials = {
  costingEmail: string | null | undefined;
  proformaInvoice: string | null | undefined;
  paymentStatus: string | null | undefined;
};

/** Financials required before Couriered / Signed Copy Received may advance. */
export function areFinancialsReadyForConfirmationLetterDelivery(
  financials: ConfirmationLetterFinancials,
): boolean {
  return (
    isCostingEmailSent(financials.costingEmail)
    && isProformaSatisfiedForConfirmationLetter(financials.proformaInvoice)
    && isPaymentMarkedCompleted(financials.paymentStatus)
  );
}

export function isConfirmationLetterDeliveryField(fieldKey: string): boolean {
  return fieldKey === "confirmation_couriered" || fieldKey === "confirmation_signed_received";
}

/** True when the new value advances Couriered (date set) or Signed (Yes). */
export function isAdvancingConfirmationLetterDelivery(
  fieldKey: string,
  value: string | null | undefined,
): boolean {
  if (fieldKey === "confirmation_couriered") {
    return Boolean((value ?? "").trim());
  }
  if (fieldKey === "confirmation_signed_received") {
    return (value ?? "").trim().toLowerCase() === "yes";
  }
  return false;
}
