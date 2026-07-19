import type { ReadinessSection, ReadinessState } from "./event-readiness";

export type VenueBookingReadinessInput = {
  venue?: string | null;
  schedule_entries?: Array<{ activity_date?: string | null }> | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function venueLabel(booking: VenueBookingReadinessInput, index: number): string {
  const name = String(booking.venue ?? "").trim();
  return name || `Venue ${index + 1}`;
}

function hasDatedScheduleEntry(booking: VenueBookingReadinessInput): boolean {
  return (booking.schedule_entries ?? []).some(
    (entry) => typeof entry.activity_date === "string" && DATE_RE.test(entry.activity_date),
  );
}

export function calculateVenueScheduleReadinessSection(
  bookings: VenueBookingReadinessInput[],
): ReadinessSection {
  if (bookings.length === 0) {
    return {
      key: "venues_schedule",
      label: "Venues & schedule",
      formSection: "venues_schedule",
      state: "missing",
      filled: 0,
      total: 1,
      percentage: 0,
      missingKeys: ["venues"],
      missingLabels: ["Add at least one venue with activity schedule"],
    };
  }

  const issues: Array<{ key: string; label: string }> = [];
  let readyCount = 0;

  bookings.forEach((booking, index) => {
    const label = venueLabel(booking, index);
    const venueSelected = Boolean(String(booking.venue ?? "").trim());
    if (!venueSelected) {
      issues.push({ key: `venue_${index}_name`, label: `${label}: select a venue` });
      return;
    }
    if (!hasDatedScheduleEntry(booking)) {
      issues.push({ key: `venue_${index}_schedule`, label: `${label}: add activity schedule` });
      return;
    }
    readyCount += 1;
  });

  const total = bookings.length;
  const percentage = total ? Math.round((readyCount / total) * 100) : 0;
  const state: ReadinessState = issues.length === 0
    ? "complete"
    : readyCount === 0
      ? "missing"
      : percentage >= 70
        ? "almost"
        : "partial";

  return {
    key: "venues_schedule",
    label: "Venues & schedule",
    formSection: "venues_schedule",
    state,
    filled: readyCount,
    total,
    percentage,
    missingKeys: issues.map((issue) => issue.key),
    missingLabels: issues.map((issue) => issue.label),
  };
}

export function venueScheduleIssueLabel(label: string): string {
  return label
    .replace(/: add activity schedule$/i, "")
    .replace(/: select a venue$/i, "")
    .trim();
}

export function normalizeVenueBookingsForReadiness(
  bookings: Array<{ venue?: unknown; schedule_entries?: unknown }>,
): VenueBookingReadinessInput[] {
  return bookings.map((booking) => ({
    venue: typeof booking.venue === "string" ? booking.venue : null,
    schedule_entries: Array.isArray(booking.schedule_entries)
      ? booking.schedule_entries as Array<{ activity_date?: string | null }>
      : [],
  }));
}

export function parseVenueBookingsForReadiness(
  rows: Array<{ venue?: string | null; schedule_json?: unknown }>,
): VenueBookingReadinessInput[] {
  return rows.map((row) => ({
    venue: row.venue,
    schedule_entries: parseScheduleDates(row.schedule_json),
  }));
}

function parseScheduleDates(raw: unknown): Array<{ activity_date?: string | null }> {
  if (Array.isArray(raw)) return raw as Array<{ activity_date?: string | null }>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed as Array<{ activity_date?: string | null }> : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const VENUE_BOOKINGS_FOR_READINESS_SQL = `
  SELECT vb.venue,
    (SELECT json_group_array(json_object('activity_date', se.activity_date))
     FROM schedule_entries se WHERE se.venue_booking_id = vb.id) AS schedule_json
  FROM venue_bookings vb
  WHERE vb.event_id = ?
  ORDER BY vb.sort_order, vb.rowid
`;
