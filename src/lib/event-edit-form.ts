import type { EventInputT } from "../../worker/lib/types";

type VenueBookingLike = Pick<EventInputT["venue_bookings"][number], "venue">;

function hasVenue(booking: VenueBookingLike): boolean {
  return booking.venue.trim().length > 0;
}

export function pruneEmptyVenueBookings(venueBookings: EventInputT["venue_bookings"]): EventInputT["venue_bookings"] {
  return venueBookings.filter(hasVenue);
}

export function canCreateEvent(form: Pick<EventInputT, "title" | "organisation_id" | "event_start_date">): boolean {
  return form.title.trim().length > 0
    && form.organisation_id.trim().length > 0
    && form.event_start_date != null
    && form.event_start_date.trim().length > 0;
}
