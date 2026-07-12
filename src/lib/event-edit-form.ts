import type { EventInputT } from "../../worker/lib/types";
import { getEventDateIssues } from "../../worker/lib/event-date-policy";

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

export function getEventFormDateError(form: Pick<EventInputT, "event_start_date" | "event_end_date" | "venue_bookings">): string | null {
  return getEventDateIssues(form)[0]?.message ?? null;
}

export function organisationValueFromName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `new:${trimmed}` : "";
}
