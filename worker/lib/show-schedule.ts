export type ShowScheduleEntryLike = {
  activity_type?: string | null;
  activity_date?: string | null;
};

/** A show schedule row represents one performance occurrence. */
export function countScheduledShows(entries: readonly ShowScheduleEntryLike[] | null | undefined): number {
  return (entries ?? []).filter((entry) => entry.activity_type === "show").length;
}

/** Show counts keyed by ISO activity date. Undated draft rows are intentionally excluded. */
export function countScheduledShowsByDate(
  entries: readonly ShowScheduleEntryLike[] | null | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries ?? []) {
    if (entry.activity_type !== "show" || !entry.activity_date) continue;
    counts.set(entry.activity_date, (counts.get(entry.activity_date) ?? 0) + 1);
  }
  return counts;
}

/**
 * Legacy venue bookings may only have an aggregate count and no schedule rows.
 * Preserve that value until the booking gains schedule detail; afterwards the
 * individual show rows become the source of truth.
 */
export function deriveVenueShowCount(
  entries: readonly ShowScheduleEntryLike[] | null | undefined,
  legacyCount: number | null | undefined,
): number {
  const schedule = entries ?? [];
  if (schedule.length === 0) return Math.max(0, Number(legacyCount) || 0);
  return countScheduledShows(schedule);
}
