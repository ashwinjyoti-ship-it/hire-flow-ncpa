import { Link } from "react-router-dom";
import { getVenueScheduleEditLink } from "../lib/venue-confirm-nudge";

type ConfirmVenueAfterPaymentBannerProps = {
  eventId: string;
  tentativeVenues: string[];
  onDismiss: () => void;
};

export function ConfirmVenueAfterPaymentBanner({
  eventId,
  tentativeVenues,
  onDismiss,
}: ConfirmVenueAfterPaymentBannerProps) {
  if (tentativeVenues.length === 0) return null;

  const venueLabel = tentativeVenues.length === 1
    ? tentativeVenues[0]
    : `${tentativeVenues.length} venues`;

  return (
    <div
      role="status"
      className="mb-5 rounded-2xl border border-sage/30 bg-sage/10 px-4 py-3 text-xs text-ink-secondary etched"
    >
      <p className="text-sm font-semibold text-sage-text etched-deep">Confirm venue booking</p>
      <p className="mt-1">
        Payment is complete and the confirmation letter has been sent.
        Please update <span className="font-medium text-ink-primary">{venueLabel}</span> from{" "}
        <span className="font-medium text-ink-primary">Tentative</span> to{" "}
        <span className="font-medium text-ink-primary">Confirmed</span> when the client is ready.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={getVenueScheduleEditLink(eventId)}
          className="carved-btn rounded-full bg-terracotta-btn px-4 py-1.5 text-xs font-semibold text-terracotta-text etched"
        >
          Open venues &amp; schedule
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="carved-btn rounded-full bg-neutral-btn px-4 py-1.5 text-xs font-medium text-ink-secondary etched"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
