type ScheduleLike = { activity_type: string; activity_date: string };
type VenueLike = { schedule_entries: ScheduleLike[] };

export type EventDateIssue = { path: string; message: string };

export function getEventDateIssues(input: {
  event_start_date?: string | null;
  event_end_date?: string | null;
  venue_bookings?: VenueLike[];
}): EventDateIssue[] {
  const start = input.event_start_date ?? null;
  const end = input.event_end_date ?? start;
  const issues: EventDateIssue[] = [];

  if (start && end && end < start) {
    issues.push({ path: "event_end_date", message: "The event end date cannot be before the start date." });
  }

  for (const [venueIndex, booking] of (input.venue_bookings ?? []).entries()) {
    for (const [scheduleIndex, entry] of booking.schedule_entries.entries()) {
      const path = `venue_bookings.${venueIndex}.schedule_entries.${scheduleIndex}.activity_date`;
      if (!entry.activity_date) continue;
      if (end && entry.activity_type !== "dismantling" && entry.activity_date > end) {
        issues.push({ path, message: `The ${entry.activity_type.replace(/_/g, " ")} date is post-show. Choose ${end} or an earlier date.` });
      }
      if (start && entry.activity_type === "show" && entry.activity_date < start) {
        issues.push({ path, message: `The show date cannot be before the event starts on ${start}.` });
      }
      if (start && entry.activity_type === "dismantling" && entry.activity_date < start) {
        issues.push({ path, message: `The dismantling date cannot be before the event starts on ${start}.` });
      }
    }
  }

  return issues;
}
