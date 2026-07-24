import {
  CATERING_MEAL_TYPES,
  cateringMealPaxKey,
  cateringMealRequiredKey,
} from "../../worker/lib/catering-meals";
import {
  CANTEEN_BEFORE_SHOW_KEY,
  CANTEEN_BETWEEN_SHOWS_KEY,
  CANTEEN_IN_INTERVAL_KEY,
  SIT_DOWN_MEALS_REQUIRED_KEY,
  THEATRE_CANTEEN_REQUIRED_KEY,
} from "../../worker/lib/theatre-canteen";
import type { EventInputT } from "../../worker/lib/types";
import { countScheduledShowsByDate } from "../../worker/lib/show-schedule";
import { deriveScheduleDaysFromEntries } from "../../worker/lib/schedule-days";
import { formatDate, formatDuration } from "./use-lookups";

export type ReviewEntry = {
  label: string;
  value: string;
};

function titleCaseWords(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatOperatingWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "—";
  return end ? `${formatDate(start)} to ${formatDate(end)}` : formatDate(start);
}

function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const [sh = 0, sm = 0] = start.split(":").map(Number);
  const [eh = 0, em = 0] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

function formatScheduleSummary(entry: EventInputT["venue_bookings"][number]["schedule_entries"][number]): string {
  const segments = [
    titleCaseWords(entry.activity_type),
    entry.start_time && entry.end_time ? `${entry.start_time} - ${entry.end_time}` : null,
    entry.notes?.trim() || null,
  ].filter((segment): segment is string => Boolean(segment && segment.trim().length > 0));

  return segments.join(" · ");
}

function formatDayTiming(day: NonNullable<EventInputT["venue_bookings"][number]["schedule_days"]>[number]): string {
  const withAcMins = day.with_ac_minutes ?? minutesBetween(day.with_ac_start, day.with_ac_end);
  const withoutAcMins = day.without_ac_minutes ?? minutesBetween(day.without_ac_start, day.without_ac_end);
  return [
    day.with_ac_start && day.with_ac_end
      ? `With AC ${day.with_ac_start} - ${day.with_ac_end} (${formatDuration(withAcMins)})`
      : null,
    day.without_ac_start && day.without_ac_end
      ? `Without AC ${day.without_ac_start} - ${day.without_ac_end} (${formatDuration(withoutAcMins)})`
      : null,
  ].filter((segment): segment is string => Boolean(segment)).join(" · ") || "No AC timings";
}

function isFilledReviewValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function formatReviewValue(value: unknown): string | null {
  if (!isFilledReviewValue(value)) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatReviewValue(item))
      .filter((item): item is string => Boolean(item));
    return items.length > 0 ? items.join(", ") : null;
  }
  return JSON.stringify(value);
}

function formatReviewLabel(key: string): string {
  const explicitLabels: Record<string, string> = {
    crew_cards: "No. of Crew Cards",
    liquor_licence: "Liquor Licence",
    liquor_licence_details: "Liquor Licence Details",
    licenses_status: "Licences — Required",
    licenses: "Licence Types",
    foyer_setup: "Foyer Setup",
    sound_call_time: "Sound Call Time",
    light_call_time: "Light Call Time",
    recording_type: "Recording Type",
    camera_count: "No. of Cameras",
    program_officer_phone: "Program Officer Contact",
    poc_name: "POC Name",
    poc_contact_number: "Contact Number",
    poc_email: "Email",
    event_company_name: "Event Company Name",
    event_company_contact_name: "Event Company Point of Contact Name",
    event_company_contact_number: "Event Company Contact Number",
    event_company_email: "Event Company Email",
    bank_details: "Bank Details",
    gst_no: "GST No.",
    tan_no: "TAN No.",
    pan_no: "PAN No.",
    signing_authority_address: "Signing Authority & Address",
    courier_address: "Courier Address",
    vendor_registration_form: "Vendor Registration Form",
    [THEATRE_CANTEEN_REQUIRED_KEY]: "Theatre Canteen Required",
    [CANTEEN_BEFORE_SHOW_KEY]: "Before Show",
    [CANTEEN_IN_INTERVAL_KEY]: "In Interval",
    [CANTEEN_BETWEEN_SHOWS_KEY]: "Between Shows",
    [SIT_DOWN_MEALS_REQUIRED_KEY]: "Sit-down Meals",
    catering_provider: "Sit-down Caterer",
  };
  for (const meal of CATERING_MEAL_TYPES) {
    explicitLabels[cateringMealRequiredKey(meal.key)] = meal.label;
    explicitLabels[cateringMealPaxKey(meal.key)] = `${meal.label} — No. of Pax`;
  }
  return explicitLabels[key] ?? titleCaseWords(key);
}

/**
 * Build the Review-step cards for the add/edit event form.
 * Every filled venue booking and schedule entry must appear — not only venue 1.
 */
export function buildReviewItems(
  form: EventInputT,
  organisationName: string | null,
  options?: { organisationType?: string | null; isVfh?: boolean },
): ReviewEntry[] {
  const items: ReviewEntry[] = [];
  const pushItem = (label: string, value: unknown) => {
    const text = formatReviewValue(value);
    if (text) items.push({ label, value: text });
  };

  pushItem("Organisation", organisationName);
  pushItem("Organisation Type", options?.organisationType);
  pushItem("Event Name", form.title);
  pushItem("Description", form.description);
  pushItem("Type", form.event_type);
  pushItem("Enquiry Source", form.enquiry_source);
  pushItem("Program Officer", form.program_officer);
  pushItem("Owner", form.event_owner);
  pushItem("Operating Window", formatOperatingWindow(form.event_start_date, form.event_end_date));

  const bookings = form.venue_bookings ?? [];
  if (bookings.length === 0) {
    pushItem("Venues", "None selected");
  } else {
    bookings.forEach((venueBooking, venueIndex) => {
      const labelPrefix = `Venue ${venueIndex + 1}`;
      pushItem(labelPrefix, venueBooking.venue || "—");
      pushItem(`${labelPrefix} Booking Status`, titleCaseWords(venueBooking.booking_status));
      pushItem(`${labelPrefix} Notes`, venueBooking.notes);
      const schedules = venueBooking.schedule_entries ?? [];
      const showsByDate = countScheduledShowsByDate(schedules);
      if (showsByDate.size > 0) {
        for (const [date, count] of showsByDate) {
          pushItem(`${labelPrefix} Shows — ${formatDate(date)}`, `${count} ${count === 1 ? "show" : "shows"}`);
        }
      } else if (schedules.length === 0 && venueBooking.number_of_shows > 0) {
        pushItem(`${labelPrefix} Shows (legacy total)`, venueBooking.number_of_shows);
      }
      if (schedules.length === 0) {
        pushItem(`${labelPrefix} Schedule`, "No schedule details");
      } else {
        const scheduleDays = venueBooking.schedule_days?.length
          ? venueBooking.schedule_days
          : deriveScheduleDaysFromEntries(schedules);
        scheduleDays.forEach((day, dayIndex) => {
          pushItem(`${labelPrefix} Schedule — ${formatDate(day.activity_date)}`, formatDayTiming(day));
          schedules.filter((entry) => entry.activity_date === day.activity_date).forEach((entry, activityIndex) => {
            pushItem(`Activity ${venueIndex + 1}.${dayIndex + 1}.${activityIndex + 1}`, formatScheduleSummary(entry));
          });
        });
      }
      const venueRequirements = (venueBooking.requirements ?? {}) as Record<string, unknown>;
      Object.entries(venueRequirements).forEach(([key, value]) => {
        if (key === "program_officer_phone") return;
        pushItem(`${labelPrefix} ${formatReviewLabel(key)}`, value);
      });
    });
  }

  const eventRequirements = (form.requirements ?? {}) as Record<string, unknown>;
  Object.entries(eventRequirements).forEach(([key, value]) => {
    pushItem(formatReviewLabel(key), value);
  });

  if (options?.isVfh) pushItem("VFH Approval", "Will apply (VFH)");

  return items;
}
