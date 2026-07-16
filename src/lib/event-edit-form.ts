import { isCateringMealPaxKey } from "../../worker/lib/catering-meals";
import type { EventInputT, VenueBookingInputT } from "../../worker/lib/types";
import { getEventDateIssues } from "../../worker/lib/event-date-policy";

type VenueBookingLike = Pick<EventInputT["venue_bookings"][number], "venue">;
type RequirementsRecord = Record<string, unknown>;

/** Keys that stay on the event (Step 1), not on each venue booking. */
export const EVENT_LEVEL_REQUIREMENT_KEYS = [
  "program_officer_phone",
  "poc_name",
  "poc_contact_number",
  "poc_email",
  "event_company_contact_name",
  "event_company_contact_number",
  "event_company_email",
  "bank_details",
  "gst_no",
  "tan_no",
  "pan_no",
  "signing_authority_address",
  "courier_address",
  "vendor_registration_form",
] as const;

const AFFIRMATIVE_VALUES = new Set(["Yes", "Required", "Keep"]);
const JOINABLE_TEXT_KEYS = new Set([
  "sound", "light", "green_room_amenities", "parking", "security", "housekeeping",
  "licenses", "licenses_status", "stage_setup", "foyer_setup", "orchestra_pit_chairs_note", "digital_standee_note",
  "car_display_note", "bike_display_note", "stalls_note", "telecasting_media_note",
  "liquor_licence_details", "catering_provider", "decorator_name", "recording_type",
]);

function hasVenue(booking: VenueBookingLike): boolean {
  return booking.venue.trim().length > 0;
}

export function pruneEmptyVenueBookings(venueBookings: EventInputT["venue_bookings"]): EventInputT["venue_bookings"] {
  return venueBookings.filter(hasVenue);
}

/** Drop schedule rows without a valid activity date — venue details are optional at save time. */
export function pruneIncompleteScheduleEntries(venueBookings: EventInputT["venue_bookings"]): EventInputT["venue_bookings"] {
  return venueBookings.map((booking) => ({
    ...booking,
    schedule_entries: (booking.schedule_entries ?? []).filter(
      (entry) => entry.activity_date && /^\d{4}-\d{2}-\d{2}$/.test(entry.activity_date),
    ),
  }));
}

/** Venue bookings ready for API save: no empty venues, no undated schedule stubs. */
export function prepareVenueBookingsForSave(venueBookings: EventInputT["venue_bookings"]): EventInputT["venue_bookings"] {
  return pruneEmptyVenueBookings(pruneIncompleteScheduleEntries(venueBookings));
}

/** Requirement decisions intentionally start unknown. Readiness only advances
 * after a user makes a choice or enters information on the event form. */
export function createDefaultVenueRequirements(): RequirementsRecord {
  return {};
}

/** Event-level requirement defaults (Step 1 fields stored in requirements JSON). */
export function createDefaultEventLevelRequirements(): RequirementsRecord {
  return { vendor_registration_form: "Not Applicable" };
}

/** Merge saved values over policy defaults without dropping explicit nulls the user set. */
export function withDefaultVenueRequirements(value: RequirementsRecord | null | undefined): RequirementsRecord {
  return { ...createDefaultVenueRequirements(), ...(value ?? {}) };
}

export function withDefaultEventLevelRequirements(value: RequirementsRecord | null | undefined): RequirementsRecord {
  return { ...createDefaultEventLevelRequirements(), ...(value ?? {}) };
}

/** Parse a requirements value that may arrive as a JSON string or already-decoded object. */
export function parseRequirements(value: unknown): RequirementsRecord | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as RequirementsRecord)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as RequirementsRecord;
  return null;
}

export function isEmptyRequirements(value: RequirementsRecord | null | undefined): boolean {
  if (!value) return true;
  return !Object.values(value).some((v) => {
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    return true;
  });
}

export function pickEventLevelRequirements(value: RequirementsRecord | null | undefined): RequirementsRecord {
  const src = value ?? {};
  const out: RequirementsRecord = {};
  for (const key of EVENT_LEVEL_REQUIREMENT_KEYS) {
    const v = src[key];
    if (v != null && !(typeof v === "string" && v.trim() === "")) out[key] = v;
  }
  return out;
}

export function omitEventLevelRequirements(value: RequirementsRecord | null | undefined): RequirementsRecord {
  const src = value ?? {};
  const out: RequirementsRecord = {};
  for (const [key, v] of Object.entries(src)) {
    if ((EVENT_LEVEL_REQUIREMENT_KEYS as readonly string[]).includes(key)) continue;
    if (v == null || (typeof v === "string" && v.trim() === "")) continue;
    out[key] = v;
  }
  return out;
}

function isAffirmative(value: unknown): boolean {
  return typeof value === "string" && AFFIRMATIVE_VALUES.has(value);
}

function joinUniqueText(existing: unknown, next: unknown): string {
  const parts = String(existing ?? "")
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = String(next ?? "").trim();
  if (candidate && !parts.includes(candidate)) parts.push(candidate);
  return parts.join(" · ");
}

/** Union venue (+ optional event-level) requirement blobs for checklist / legacy event column. */
export function aggregateRequirements(
  sources: Array<RequirementsRecord | null | undefined>,
): RequirementsRecord {
  const out: RequirementsRecord = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [key, value] of Object.entries(src)) {
      if (value == null || (typeof value === "string" && value.trim() === "")) continue;
      const current = out[key];
      if (current == null || (typeof current === "string" && current.trim() === "")) {
        out[key] = value;
        continue;
      }
      if (isAffirmative(value) && !isAffirmative(current)) {
        out[key] = value;
        continue;
      }
      if (key === "crew_cards" || key === "camera_count" || isCateringMealPaxKey(key)) {
        const max = Math.max(Number(current) || 0, Number(value) || 0);
        out[key] = String(max);
        continue;
      }
      if (JOINABLE_TEXT_KEYS.has(key) && typeof current === "string" && typeof value === "string" && current !== value) {
        out[key] = joinUniqueText(current, value);
      }
    }
  }
  return out;
}

/**
 * When editing legacy events, copy events.requirements into venue bookings that
 * have no requirements yet so Step 3 is not blank.
 */
export function hydrateVenueRequirements(
  bookings: VenueBookingInputT[],
  eventRequirements: RequirementsRecord | null | undefined,
): VenueBookingInputT[] {
  const venueSeed = omitEventLevelRequirements(eventRequirements);
  if (isEmptyRequirements(venueSeed) || bookings.length === 0) return bookings;

  // Legacy event rows may contain a requirements union while venue rows carry
  // only unrelated metadata. Preserve every legacy key that is not already
  // represented by any venue, but seed it once so multi-venue data is not
  // duplicated across every booking on the next save.
  const capturedKeys = new Set<string>();
  for (const booking of bookings) {
    const requirements = booking.requirements as RequirementsRecord | null;
    for (const [key, value] of Object.entries(requirements ?? {})) {
      if (value != null && !(typeof value === "string" && value.trim() === "")) capturedKeys.add(key);
    }
  }
  const missingLegacy = Object.fromEntries(
    Object.entries(venueSeed).filter(([key]) => !capturedKeys.has(key)),
  );
  if (isEmptyRequirements(missingLegacy)) return bookings;
  return bookings.map((booking, index) => index === 0
    ? { ...booking, requirements: { ...missingLegacy, ...((booking.requirements as RequirementsRecord | null) ?? {}) } }
    : booking);
}

/** Build the denormalised events.requirements payload (event-level keys + venue union). */
export function buildEventRequirementsPayload(
  venueBookings: VenueBookingInputT[],
  eventLevel: RequirementsRecord | null | undefined,
): RequirementsRecord {
  return aggregateRequirements([
    pickEventLevelRequirements(eventLevel),
    ...venueBookings.map((booking) => omitEventLevelRequirements(booking.requirements as RequirementsRecord | null)),
  ]);
}

/** @deprecated Use prepareVenueBookingsForSave — incomplete schedule rows are dropped, not blocked. */
export function getScheduleValidationError(venueBookings: EventInputT["venue_bookings"]): string | null {
  void venueBookings;
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
