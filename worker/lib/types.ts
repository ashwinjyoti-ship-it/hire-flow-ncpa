/**
 * Shared domain types + Zod schemas for events, organisations, venue bookings,
 * and schedule entries. Used by both the Worker API and the React SPA.
 */
import { z } from "zod";

export const IsoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid calendar date");

// ---- Organisations ----
export const OrganisationInput = z.object({
  name: z.string().min(1),
  org_type: z.string().nullish(),
  address: z.string().nullish(),
  gst_number: z.string().nullish(),
  pan_number: z.string().nullish(),
  tan_number: z.string().nullish(),
  bank_details: z.record(z.unknown()).nullish(),
  notes: z.string().nullish(),
});
export type OrganisationInputT = z.infer<typeof OrganisationInput>;

export const ContactInput = z.object({
  name: z.string().min(1),
  role: z.string().nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  is_primary: z.boolean().optional(),
  signing_authority: z.boolean().optional(),
  courier_address: z.string().nullish(),
});
export type ContactInputT = z.infer<typeof ContactInput>;

// ---- Schedule entries ----
export const ACTIVITY_TYPES = ["setup", "rehearsal", "show", "dismantling", "zero_show"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  setup: "Setup",
  rehearsal: "Rehearsal",
  show: "Show",
  dismantling: "Dismantling",
  zero_show: "Zero Show",
};

export function formatActivityType(value: string): string {
  return ACTIVITY_TYPE_LABELS[value as ActivityType] ?? value.replace(/_/g, " ");
}

export const ScheduleEntryInput = z.object({
  id: z.string().optional(),
  activity_type: z.enum(ACTIVITY_TYPES),
  activity_date: IsoDate,
  start_time: z.string().nullish(),
  end_time: z.string().nullish(),
  // AC timing sub-windows (rental duration/day = with_ac + without_ac).
  with_ac_start: z.string().nullish(),
  with_ac_end: z.string().nullish(),
  with_ac_minutes: z.number().int().nonnegative().nullish(),
  without_ac_start: z.string().nullish(),
  without_ac_end: z.string().nullish(),
  without_ac_minutes: z.number().int().nonnegative().nullish(),
  notes: z.string().nullish(),
});
export type ScheduleEntryInputT = z.infer<typeof ScheduleEntryInput>;

// AC/non-AC is a venue-day operating window shared by every activity that day.
// The API still mirrors these values onto schedule entries for compatibility
// with calendar/report consumers that read the legacy row shape.
export const ScheduleDayInput = z.object({
  activity_date: IsoDate,
  with_ac_start: z.string().nullish(),
  with_ac_end: z.string().nullish(),
  with_ac_minutes: z.number().int().nonnegative().nullish(),
  without_ac_start: z.string().nullish(),
  without_ac_end: z.string().nullish(),
  without_ac_minutes: z.number().int().nonnegative().nullish(),
});
export type ScheduleDayInputT = z.infer<typeof ScheduleDayInput>;

// ---- Venue bookings ----
// Note: per-venue 'cancelled' is intentionally absent from the create/update
// enum. Cancellation is an event-level concept (events.status -> 'cancelled'),
// not a venue-level dropdown. Existing rows / DB schema still allow the value.
export const VenueBookingInput = z.object({
  id: z.string().optional(),
  venue: z.string().min(1),
  booking_status: z.enum(["tentative", "confirmed"]).default("tentative"),
  // Derived from individual `show` schedule rows. Zero is valid for setup,
  // rehearsal, dismantling, and explicit Zero Show bookings.
  number_of_shows: z.number().int().min(0).default(0),
  requirements: z.record(z.unknown()).nullish(),
  notes: z.string().nullish(),
  schedule_days: z.array(ScheduleDayInput).optional(),
  schedule_entries: z.array(ScheduleEntryInput).default([]),
});
export type VenueBookingInputT = z.infer<typeof VenueBookingInput>;

// ---- Events ----
export const EventInput = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  // Organisation is the anchor of the record — every event hangs off one org.
  organisation_id: z.string().min(1, "Organisation is required"),
  primary_contact_id: z.string().nullish(),
  event_type: z.enum(["EE", "FR", "VFH", "Free Event"]).nullish(),
  program_officer: z.string().nullish(),
  event_owner: z.string().nullish(),
  // Phase 8b: optional link to the owning user account. When set, tasks
  // auto-route to this user and "My events" filters on it. event_owner (text)
  // is kept as a denormalised display label.
  event_owner_id: z.string().nullish(),
  event_start_date: IsoDate.nullish(),
  event_end_date: IsoDate.nullish(),
  enquiry_source: z.string().nullish(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  requirements: z.record(z.unknown()).nullish(),
  notes: z.string().nullish(),
  venue_bookings: z.array(VenueBookingInput).default([]),
});
export type EventInputT = z.infer<typeof EventInput>;

// ---- Status transition ----
export const StatusTransitionInput = z.object({
  to_status: z.string().min(1),
  reason: z.string().nullish(),
  note: z.string().nullish(),
});
export type StatusTransitionInputT = z.infer<typeof StatusTransitionInput>;
