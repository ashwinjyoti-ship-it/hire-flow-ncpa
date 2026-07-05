/**
 * Shared domain types + Zod schemas for events, organisations, venue bookings,
 * and schedule entries. Used by both the Worker API and the React SPA.
 */
import { z } from "zod";

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
export const ACTIVITY_TYPES = ["setup", "rehearsal", "show", "dismantling", "technical_meeting"] as const;

export const ScheduleEntryInput = z.object({
  activity_type: z.enum(ACTIVITY_TYPES),
  activity_date: z.string().min(1),
  start_time: z.string().nullish(),
  end_time: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ScheduleEntryInputT = z.infer<typeof ScheduleEntryInput>;

// ---- Venue bookings ----
export const VenueBookingInput = z.object({
  venue: z.string().min(1),
  booking_status: z.enum(["tentative", "confirmed", "cancelled"]).default("tentative"),
  number_of_shows: z.number().int().min(1).default(1),
  ac_start: z.string().nullish(),
  ac_end: z.string().nullish(),
  event_duration_minutes: z.number().int().positive().nullish(),
  requirements: z.record(z.unknown()).nullish(),
  notes: z.string().nullish(),
  schedule_entries: z.array(ScheduleEntryInput).default([]),
});
export type VenueBookingInputT = z.infer<typeof VenueBookingInput>;

// ---- Events ----
export const EventInput = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  organisation_id: z.string().nullish(),
  primary_contact_id: z.string().nullish(),
  event_type: z.enum(["EE", "FR", "VFH", "Free Event"]).nullish(),
  hiring_category: z.string().nullish(),
  vertical: z.string().nullish(),
  program_officer: z.string().nullish(),
  event_owner: z.string().nullish(),
  collaboration_details: z.string().nullish(),
  event_start_date: z.string().nullish(),
  event_end_date: z.string().nullish(),
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
