import type { EventInputT } from "../../worker/lib/types";
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
  const withAcMins = entry.with_ac_minutes ?? minutesBetween(entry.with_ac_start, entry.with_ac_end);
  const withoutAcMins = entry.without_ac_minutes ?? minutesBetween(entry.without_ac_start, entry.without_ac_end);
  const segments = [
    titleCaseWords(entry.activity_type),
    entry.activity_date ? formatDate(entry.activity_date) : null,
    entry.start_time && entry.end_time ? `${entry.start_time} - ${entry.end_time}` : null,
    entry.with_ac_start && entry.with_ac_end
      ? `With AC ${entry.with_ac_start} - ${entry.with_ac_end} (${formatDuration(withAcMins)})`
      : null,
    entry.without_ac_start && entry.without_ac_end
      ? `Without AC ${entry.without_ac_start} - ${entry.without_ac_end} (${formatDuration(withoutAcMins)})`
      : null,
    entry.notes?.trim() || null,
  ].filter((segment): segment is string => Boolean(segment && segment.trim().length > 0));

  return segments.join(" · ");
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
    no_of_pax: "No. of Pax",
    crew_cards: "No. of Crew Cards",
    liquor_licence: "Liquor Licence",
    liquor_licence_details: "Liquor Licence Details",
    sound_call_time: "Sound Call Time",
    light_call_time: "Light Call Time",
    recording_type: "Recording Type",
    camera_count: "No. of Cameras",
    program_officer_phone: "Program Officer Contact",
  };
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
      pushItem(`${labelPrefix} Number of Shows`, venueBooking.number_of_shows);
      pushItem(`${labelPrefix} Notes`, venueBooking.notes);
      const schedules = venueBooking.schedule_entries ?? [];
      if (schedules.length === 0) {
        pushItem(`${labelPrefix} Schedule`, "No schedule details");
      } else {
        schedules.forEach((entry, scheduleIndex) => {
          pushItem(`Schedule ${venueIndex + 1}.${scheduleIndex + 1}`, formatScheduleSummary(entry));
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
