export type ScheduleEntryLike = {
  id?: string | null;
  activity_type?: string | null;
  activity_date?: string | null;
};

export type VenueBookingLike = {
  id?: unknown;
  schedule_entries?: readonly unknown[] | null;
};

function asScheduleEntries(entries: readonly unknown[] | null | undefined): ScheduleEntryLike[] {
  return (entries ?? []) as ScheduleEntryLike[];
}

export function getVenueBookingKey(booking: VenueBookingLike, index: number): string {
  const id = typeof booking.id === "string" ? booking.id.trim() : "";
  return id || `venue-${index}`;
}

export function formatScheduleSummary(entries: readonly unknown[]): string {
  const scheduleEntries = asScheduleEntries(entries);
  if (scheduleEntries.length === 0) return "No schedule yet";
  const activityLabel = scheduleEntries.length === 1 ? "activity" : "activities";
  const dates = new Set(scheduleEntries.map((entry) => entry.activity_date).filter(Boolean));
  if (dates.size === 0) return `${scheduleEntries.length} ${activityLabel}`;
  const dateLabel = dates.size === 1 ? "date" : "dates";
  return `${scheduleEntries.length} ${activityLabel} · ${dates.size} ${dateLabel}`;
}

/** Keep the first venue open when many venues would otherwise crowd the tab. */
export function getDefaultExpandedVenueKeys(bookings: VenueBookingLike[]): Set<string> {
  if (bookings.length <= 2) {
    return new Set(bookings.map((booking, index) => getVenueBookingKey(booking, index)));
  }
  return new Set([getVenueBookingKey(bookings[0]!, 0)]);
}

/** Switch to a denser table when a venue has many activities. */
export function shouldUseCompactSchedule(entriesCount: number): boolean {
  return entriesCount >= 4;
}

/** Only use a two-column card grid for a single venue with a small schedule. */
export function shouldUseTwoColumnSchedule(entriesCount: number, venueCount: number): boolean {
  return venueCount === 1 && entriesCount > 0 && entriesCount <= 2;
}

/** Tab label — setup/rehearsal without show stays "Partially filled". */
export function venuesAndScheduleTabLabel(
  bookingCount: number,
  readinessState?: string | null,
): string {
  if (!bookingCount) return "Venues & Schedule";
  const partial = readinessState === "partial" || readinessState === "almost";
  return partial
    ? `Venues & Schedule (${bookingCount}) · Partially filled`
    : `Venues & Schedule (${bookingCount})`;
}
