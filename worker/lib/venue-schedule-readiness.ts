import type { ReadinessSection, ReadinessState } from "./event-readiness";
import { ACTIVITY_TYPES, formatActivityType } from "./types";

export const VENUES_SCHEDULE_READINESS_KEY = "venues_schedule";
export const VENUES_SCHEDULE_ANCHOR_ID = "event-venues-schedule";

export type VenueBookingReadinessInput = {
  venue?: string | null;
  number_of_shows?: number | null;
  schedule_entries?: Array<{ activity_type?: string | null; activity_date?: string | null }> | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Preferred display order for set activity chips. */
const ACTIVITY_LABEL_ORDER = ["setup", "rehearsal", "zero_show", "show", "dismantling"] as const;

function venueLabel(booking: VenueBookingReadinessInput, index: number): string {
  const name = String(booking.venue ?? "").trim();
  return name || `Venue ${index + 1}`;
}

function hasDatedScheduleEntry(booking: VenueBookingReadinessInput): boolean {
  return (booking.schedule_entries ?? []).some(
    (entry) => typeof entry.activity_date === "string" && DATE_RE.test(entry.activity_date),
  );
}

/** Show is the real schedule activity — setup/rehearsal alone is only partial. */
function hasDatedShowEntry(booking: VenueBookingReadinessInput): boolean {
  return (booking.schedule_entries ?? []).some(
    (entry) =>
      entry.activity_type === "show"
      && typeof entry.activity_date === "string"
      && DATE_RE.test(entry.activity_date),
  );
}

export function collectSetActivityLabels(bookings: VenueBookingReadinessInput[]): string[] {
  const set = new Set<string>();
  for (const booking of bookings) {
    for (const entry of booking.schedule_entries ?? []) {
      if (
        typeof entry.activity_type === "string"
        && (ACTIVITY_TYPES as readonly string[]).includes(entry.activity_type)
        && typeof entry.activity_date === "string"
        && DATE_RE.test(entry.activity_date)
      ) {
        set.add(entry.activity_type);
      }
    }
  }
  return ACTIVITY_LABEL_ORDER.filter((type) => set.has(type)).map((type) => formatActivityType(type));
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
      setLabels: [],
    };
  }

  const issues: Array<{ key: string; label: string }> = [];
  let readyCount = 0;
  let hasPartialSchedule = false;

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
    if (!hasDatedShowEntry(booking)) {
      hasPartialSchedule = true;
      issues.push({ key: `venue_${index}_show`, label: `${label}: add show` });
      return;
    }
    readyCount += 1;
  });

  const total = bookings.length;
  const percentage = total ? Math.round((readyCount / total) * 100) : 0;
  const state: ReadinessState = issues.length === 0
    ? "complete"
    : readyCount === 0 && !hasPartialSchedule
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
    setLabels: collectSetActivityLabels(bookings),
  };
}

export function venueScheduleIssueLabel(label: string): string {
  return label
    .replace(/: add show$/i, "")
    .replace(/: add activity schedule$/i, "")
    .replace(/: select a venue$/i, "")
    .trim();
}

export function normalizeVenueBookingsForReadiness(
  bookings: Array<{ venue?: unknown; number_of_shows?: unknown; schedule_entries?: unknown }>,
): VenueBookingReadinessInput[] {
  return bookings.map((booking) => ({
    venue: typeof booking.venue === "string" ? booking.venue : null,
    number_of_shows: typeof booking.number_of_shows === "number" ? booking.number_of_shows : null,
    schedule_entries: Array.isArray(booking.schedule_entries)
      ? booking.schedule_entries as Array<{ activity_type?: string | null; activity_date?: string | null }>
      : [],
  }));
}

export function parseVenueBookingsForReadiness(
  rows: Array<{ venue?: string | null; number_of_shows?: number | null; schedule_json?: unknown }>,
): VenueBookingReadinessInput[] {
  return rows.map((row) => ({
    venue: row.venue,
    number_of_shows: row.number_of_shows ?? null,
    schedule_entries: parseScheduleEntries(row.schedule_json),
  }));
}

function parseScheduleEntries(raw: unknown): Array<{ activity_type?: string | null; activity_date?: string | null }> {
  if (Array.isArray(raw)) {
    return raw as Array<{ activity_type?: string | null; activity_date?: string | null }>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed as Array<{ activity_type?: string | null; activity_date?: string | null }>
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const VENUE_BOOKINGS_FOR_READINESS_SQL = `
  SELECT vb.venue,
    vb.number_of_shows,
    (SELECT json_group_array(json_object(
      'activity_date', se.activity_date,
      'activity_type', se.activity_type
    ))
     FROM schedule_entries se WHERE se.venue_booking_id = vb.id) AS schedule_json
  FROM venue_bookings vb
  WHERE vb.event_id = ?
  ORDER BY vb.sort_order, vb.rowid
`;
