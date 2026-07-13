import type { EventInputT } from "../../worker/lib/types";
import { getEventDateIssues } from "../../worker/lib/event-date-policy";

type VenueBookingLike = Pick<EventInputT["venue_bookings"][number], "venue">;

function hasVenue(booking: VenueBookingLike): boolean {
  return booking.venue.trim().length > 0;
}

export function pruneEmptyVenueBookings(venueBookings: EventInputT["venue_bookings"]): EventInputT["venue_bookings"] {
  return venueBookings.filter(hasVenue);
}

/** Incomplete schedule rows (no activity date) fail Zod on the API and block the whole save. */
export function getScheduleValidationError(venueBookings: EventInputT["venue_bookings"]): string | null {
  for (const [venueIndex, booking] of venueBookings.entries()) {
    for (const [scheduleIndex, entry] of (booking.schedule_entries ?? []).entries()) {
      if (!entry.activity_date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.activity_date)) {
        return `Venue ${venueIndex + 1}, schedule ${scheduleIndex + 1}: choose an activity date before saving.`;
      }
    }
  }
  return null;
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
