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

function sumMinutes(
  entries: EventInputT["venue_bookings"][number]["schedule_entries"],
  key: "with_ac_minutes" | "without_ac_minutes",
  startKey: "with_ac_start" | "without_ac_start",
  endKey: "with_ac_end" | "without_ac_end",
): number | null {
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, entry) => {
    const duration = entry[key] ?? minutesBetween(entry[startKey], entry[endKey]);
    return sum + (duration ?? 0);
  }, 0);
  return total > 0 ? total : null;
}

function formatHours(entries: EventInputT["venue_bookings"][number]["schedule_entries"]): string {
  const withAc = sumMinutes(entries, "with_ac_minutes", "with_ac_start", "with_ac_end");
  const withoutAc = sumMinutes(entries, "without_ac_minutes", "without_ac_start", "without_ac_end");
  return `With AC ${formatDuration(withAc)} · Without AC ${formatDuration(withoutAc)}`;
}

export function buildReviewItems(form: EventInputT, organisationName: string | null): ReviewEntry[] {
  const firstBooking = form.venue_bookings[0];
  return [
    { label: "Organisation", value: organisationName?.trim() || "—" },
    { label: "Event Name", value: form.title.trim() || "—" },
    { label: "Operating Window", value: formatOperatingWindow(form.event_start_date, form.event_end_date) },
    { label: "Venue Booking Status", value: firstBooking ? titleCaseWords(firstBooking.booking_status) : "—" },
    { label: "Number of Shows", value: firstBooking ? String(firstBooking.number_of_shows) : "—" },
    { label: "AC Hours", value: firstBooking ? formatHours(firstBooking.schedule_entries) : "—" },
  ];
}
