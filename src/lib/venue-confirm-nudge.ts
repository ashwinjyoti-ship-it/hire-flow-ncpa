import { isPaymentMarkedCompleted } from "../../worker/lib/financial-sequence";

const DISMISS_PREFIX = "venue_confirm_nudge_dismissed:";

export type VenueBookingLike = {
  venue?: string | null;
  booking_status?: string | null;
};

/** Confirmation letter has been sent to the client (couriered or signed). */
export function isConfirmationLetterSent(confirmationStatus: string | null | undefined): boolean {
  const normalised = (confirmationStatus ?? "").trim().toLowerCase();
  return normalised === "couriered" || normalised === "signed_received";
}

export function getTentativeVenueNames(bookings: VenueBookingLike[]): string[] {
  return bookings
    .filter((booking) => (booking.booking_status ?? "").trim().toLowerCase() === "tentative")
    .map((booking) => (booking.venue ?? "").trim())
    .filter(Boolean);
}

export function shouldShowConfirmVenueNudge(input: {
  eventStatus: string;
  paymentStatus: string | null | undefined;
  confirmationStatus: string | null | undefined;
  venueBookings: VenueBookingLike[];
  dismissed: boolean;
}): boolean {
  if (input.dismissed) return false;
  if (input.eventStatus === "cancelled" || input.eventStatus === "regret") return false;
  if (!isPaymentMarkedCompleted(input.paymentStatus)) return false;
  if (!isConfirmationLetterSent(input.confirmationStatus)) return false;
  return getTentativeVenueNames(input.venueBookings).length > 0;
}

export function isVenueConfirmNudgeDismissed(eventId: string): boolean {
  try {
    return sessionStorage.getItem(`${DISMISS_PREFIX}${eventId}`) === "1";
  } catch {
    return false;
  }
}

export function dismissVenueConfirmNudge(eventId: string): void {
  try {
    sessionStorage.setItem(`${DISMISS_PREFIX}${eventId}`, "1");
  } catch {
    // Ignore storage failures — the banner can still render for this visit.
  }
}

export function getVenueScheduleEditLink(eventId: string): string {
  return `/events/${eventId}/edit?step=1`;
}
