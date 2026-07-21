/**
 * Minutes of Meeting (MoM) generator — compiles an event record into the
 * email-style operational MoM used by Venue for Hire.
 *
 * Auto-generated content runs through Program Officer. Everything after that
 * comes from the caller's customised notes block (Technical Officer, etc.).
 * Empty sections / lines render as "TBC".
 */

import {
  CATERING_MEAL_TYPES,
  cateringMealPaxKey,
  cateringMealRequiredKey,
} from "../../worker/lib/catering-meals";
import { buildPrintablePageHtml } from "../../shared/printable-html";
import { deriveVenueShowCount } from "../../worker/lib/show-schedule";
import { escapeHtml } from "./export";
import { omitEventLevelRequirements } from "./event-edit-form";

export type MomScheduleEntry = {
  activity_type?: string | null;
  activity_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  with_ac_start?: string | null;
  with_ac_end?: string | null;
  without_ac_start?: string | null;
  without_ac_end?: string | null;
  notes?: string | null;
};

export type MomVenueBooking = {
  venue?: string | null;
  number_of_shows?: number | null;
  notes?: string | null;
  requirements?: Record<string, unknown> | string | null;
  schedule_entries?: MomScheduleEntry[] | null;
};

export type MomEventInput = {
  title?: string | null;
  description?: string | null;
  event_type?: string | null;
  organisation_name?: string | null;
  program_officer?: string | null;
  event_start_date?: string | null;
  event_end_date?: string | null;
  requirements?: Record<string, unknown> | string | null;
  venue_bookings?: MomVenueBooking[] | null;
};

export type MomMissingField = { key: string; label: string };

const TBC = "TBC";

function parseRequirements(value: MomEventInput["requirements"]): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value;
}

function isEmptyReqs(reqs: Record<string, unknown>): boolean {
  return !Object.values(reqs).some((v) => filled(v));
}

/** Prefer venue requirements; fall back to event-level (minus contact) for legacy data. */
function resolveVenueRequirements(
  booking: MomVenueBooking,
  eventReqs: Record<string, unknown>,
): Record<string, unknown> {
  const venueReqs = parseRequirements(booking.requirements);
  if (!isEmptyReqs(venueReqs)) return venueReqs;
  return omitEventLevelRequirements(eventReqs);
}

/** Union of event + all venue requirements (for missing-field checks and single-blob sections). */
function aggregateMomRequirements(input: MomEventInput): Record<string, unknown> {
  const eventReqs = parseRequirements(input.requirements);
  const out: Record<string, unknown> = { ...eventReqs };
  for (const booking of input.venue_bookings ?? []) {
    const venueReqs = resolveVenueRequirements(booking, eventReqs);
    for (const [key, value] of Object.entries(venueReqs)) {
      if (!filled(out[key]) && filled(value)) out[key] = value;
      else if (filled(value) && (value === "Yes" || value === "Required" || value === "Keep")) out[key] = value;
    }
  }
  return out;
}

function withVenuePrefix(venue: string | null | undefined, lines: string[]): string[] {
  const label = text(venue);
  if (!label || lines.length === 0 || (lines.length === 1 && lines[0] === TBC)) return lines;
  return [`[${label}]`, ...lines];
}

function filled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "boolean") return true;
  return false;
}

function text(value: unknown): string | null {
  if (!filled(value)) return null;
  if (typeof value === "string") return value.trim();
  return String(value);
}

function orTbc(value: unknown): string {
  return text(value) ?? TBC;
}

function isYes(value: unknown, yesValue = "Yes"): boolean {
  return value === yesValue || value === "Yes" || value === "Required" || value === "Keep";
}

function formatEventType(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "VFH") return "Venue for Hire";
  if (value === "EE") return "External Event";
  if (value === "FR") return "Fundraising";
  if (value === "FE" || value === "Free Event") return "Free Event";
  return value;
}

/** Long weekday date matching MoM email style, e.g. Thursday, July 30, 2026. */
export function formatMomLongDate(iso: string | null | undefined): string {
  if (!iso) return TBC;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00+05:30` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** 12-hour clock for MoM body (2:30pm). */
export function formatMomTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return value.trim();
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value.trim();
  const suffix = hours >= 12 ? "pm" : "am";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return minutes === 0 ? `${hours}${suffix}` : `${hours}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function formatMomTimeRange(start: string | null | undefined, end: string | null | undefined): string | null {
  const a = formatMomTime(start);
  const b = formatMomTime(end);
  if (!a && !b) return null;
  if (a && b) return `${a} to ${b}`;
  return a ?? b;
}

function activityLabel(type: string | null | undefined): string {
  if (!type) return "Activity";
  return type.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function section(title: string, bodyLines: string[]): string {
  const body = bodyLines.length > 0 ? bodyLines.join("\n") : TBC;
  return `${title}\n\n${body}`;
}

function yesNoLine(label: string, value: unknown, note?: unknown): string | null {
  const choice = text(value);
  const noteText = text(note);
  if (!choice && !noteText) return null;
  if (choice && noteText) return `${label}: ${choice} — ${noteText}`;
  if (choice) return `${label}: ${choice}`;
  return `${label}: ${noteText}`;
}

export function getMomMissingFields(input: MomEventInput): MomMissingField[] {
  const reqs = aggregateMomRequirements(input);
  const bookings = input.venue_bookings ?? [];
  const entries = bookings.flatMap((b) => b.schedule_entries ?? []);
  const missing: MomMissingField[] = [];

  const push = (key: string, label: string, ok: boolean) => {
    if (!ok) missing.push({ key, label });
  };

  push("organisation_name", "Organisation", filled(input.organisation_name));
  push("title", "Event Name", filled(input.title));
  push("event_start_date", "Event Start Date", filled(input.event_start_date));
  push("venue", "Venue", bookings.some((b) => filled(b.venue)));
  push("schedule", "Schedule / Timings", entries.length > 0);
  push("program_officer", "Program Officer", filled(input.program_officer));
  push("program_officer_phone", "Program Officer Contact", filled(reqs.program_officer_phone));
  push("sound", "Sound Requirements", filled(reqs.sound));
  push("light", "Light Requirements", filled(reqs.light));
  push("security", "Security Notes", filled(reqs.security) || filled(reqs.parking));
  push("housekeeping", "Housekeeping", filled(reqs.housekeeping));
  push("stage_setup", "Stage Setup", filled(reqs.stage_setup));
  push("foyer_setup", "Foyer Setup", filled(reqs.foyer_setup));

  if (isYes(reqs.catering_required, "Yes")) {
    push("catering_provider", "Caterer", filled(reqs.catering_provider));
    push("interval", "Interval", filled(reqs.interval));
    for (const meal of CATERING_MEAL_TYPES) {
      const requiredKey = cateringMealRequiredKey(meal.key);
      if (isYes(reqs[requiredKey], "Yes")) {
        push(cateringMealPaxKey(meal.key), `${meal.label} — No. of Pax`, filled(reqs[cateringMealPaxKey(meal.key)]));
      }
    }
  }

  return missing;
}

function buildNatureLines(input: MomEventInput, reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const description = text(input.description);
  const title = text(input.title);
  if (description) lines.push(description);
  else if (title) lines.push(title);
  else lines.push(TBC);

  const type = formatEventType(text(input.event_type));
  if (type) lines.push(type);

  const houseRelease = text(reqs.house_seats_release);
  const houseTickets = text(reqs.house_tickets);
  if (houseRelease || houseTickets) {
    const parts = [
      houseRelease ? `House seats release: ${houseRelease}` : null,
      houseTickets ? `House tickets: ${houseTickets}` : null,
    ].filter(Boolean);
    lines.push(parts.join(" · "));
  }

  return lines;
}

function buildTimingLines(bookings: MomVenueBooking[]): string[] {
  if (bookings.length === 0) return [TBC];
  const lines: string[] = [];

  for (const booking of bookings) {
    const venue = text(booking.venue) ?? TBC;
    const entries = [...(booking.schedule_entries ?? [])].sort((a, b) =>
      String(a.activity_date ?? "").localeCompare(String(b.activity_date ?? ""))
      || String(a.start_time ?? "").localeCompare(String(b.start_time ?? ""))
    );

    if (entries.length === 0) {
      lines.push(`${venue} – ${TBC}`);
      continue;
    }

    for (const entry of entries) {
      const dateLabel = formatMomLongDate(entry.activity_date);
      lines.push(`${dateLabel}, ${venue} –`);
      lines.push(`${activityLabel(entry.activity_type)}: ${formatMomTimeRange(entry.start_time, entry.end_time) ?? TBC}`);
      const withoutAc = formatMomTimeRange(entry.without_ac_start, entry.without_ac_end);
      const withAc = formatMomTimeRange(entry.with_ac_start, entry.with_ac_end);
      if (withoutAc) lines.push(`Without AC: ${withoutAc}`);
      if (withAc) lines.push(`With AC: ${withAc}`);
      if (!withoutAc && !withAc) {
        // keep timings visible even when AC windows are unset
      }
      const note = text(entry.notes);
      if (note) lines.push(note);
      lines.push("");
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : [TBC];
}

function buildGuestLines(bookings: MomVenueBooking[], eventReqs: Record<string, unknown>): string[] {
  if (bookings.length <= 1) {
    const reqs = bookings[0] ? resolveVenueRequirements(bookings[0], eventReqs) : eventReqs;
    return buildGuestLinesForReqs(bookings, reqs);
  }
  const lines: string[] = [];
  for (const booking of bookings) {
    const reqs = resolveVenueRequirements(booking, eventReqs);
    const venueLines = buildGuestLinesForReqs([booking], reqs);
    lines.push(...withVenuePrefix(booking.venue, venueLines), "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : [TBC];
}

function buildGuestLinesForReqs(bookings: MomVenueBooking[], reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const totalShows = bookings.reduce(
    (sum, booking) => sum + deriveVenueShowCount(booking.schedule_entries, booking.number_of_shows),
    0,
  );
  if (totalShows > 0) {
    lines.push(totalShows === 1 ? "One show only" : `${totalShows} shows`);
  }

  const shows = bookings.flatMap((b) =>
    (b.schedule_entries ?? []).filter((e) => e.activity_type === "show")
  );
  if (shows.length === 0) {
    lines.push(`Show Time – ${TBC}`);
  } else {
    for (const show of shows) {
      lines.push(`Show Time – ${formatMomTimeRange(show.start_time, show.end_time) ?? TBC}`);
    }
  }

  const ushersRequired = text(reqs.ushers_required);
  const ushersCall = formatMomTime(text(reqs.ushers_call_time));
  if (ushersRequired || ushersCall) {
    if (ushersCall) lines.push(`Ushers at ${ushersCall}`);
    else lines.push(`Ushers – ${orTbc(ushersRequired)}`);
  } else {
    lines.push(`Ushers – ${TBC}`);
  }

  const interval = text(reqs.interval);
  if (interval) {
    lines.push(`Interval – ${interval}`);
  } else if (isYes(reqs.catering_required, "Yes")) {
    lines.push(`Interval – ${TBC}`);
  }

  return lines.length > 0 ? lines : [TBC];
}

function buildVendorLines(bookings: MomVenueBooking[], eventReqs: Record<string, unknown>): string[] {
  if (bookings.length <= 1) {
    const reqs = bookings[0] ? resolveVenueRequirements(bookings[0], eventReqs) : eventReqs;
    return buildVendorLinesForReqs(reqs);
  }
  const lines: string[] = [];
  for (const booking of bookings) {
    const reqs = resolveVenueRequirements(booking, eventReqs);
    lines.push(...withVenuePrefix(booking.venue, buildVendorLinesForReqs(reqs)), "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : [TBC];
}

function formatCateringMealPaxSummary(reqs: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const meal of CATERING_MEAL_TYPES) {
    if (!isYes(reqs[cateringMealRequiredKey(meal.key)], "Yes")) continue;
    const pax = text(reqs[cateringMealPaxKey(meal.key)]);
    parts.push(pax ? `${meal.label}: ${pax} pax` : `${meal.label}: ${TBC}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function buildVendorLinesForReqs(reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];

  if (isYes(reqs.catering_required, "Yes")) {
    const caterer = text(reqs.catering_provider) ?? TBC;
    const mealPax = formatCateringMealPaxSummary(reqs);
    const interval = text(reqs.interval);
    let catererLine = `Caterer - ${caterer}`;
    if (mealPax) catererLine += ` (${mealPax})`;
    if (interval) catererLine += `. Interval: ${interval}`;
    lines.push(catererLine);
  } else if (filled(reqs.catering_required)) {
    lines.push("Caterer - Not required");
  } else {
    lines.push(`Caterer - ${TBC}`);
  }

  const light = text(reqs.light);
  const lightCall = formatMomTime(text(reqs.light_call_time));
  lines.push(
    light
      ? `Lights – ${light}${lightCall ? ` (call: ${lightCall})` : ""}`
      : `Lights – ${TBC}`
  );

  const sound = text(reqs.sound);
  const soundCall = formatMomTime(text(reqs.sound_call_time));
  lines.push(
    sound
      ? `Sound – ${sound}${soundCall ? ` (call: ${soundCall})` : ""}`
      : `Sound – ${TBC}`
  );

  if (isYes(reqs.decorator_required, "Yes")) {
    lines.push(`Decorator - ${text(reqs.decorator_name) ?? TBC}`);
  }

  const licenseStatus = text(reqs.licenses_status);
  const licenseTypes = text(reqs.licenses);
  if (licenseStatus || licenseTypes) {
    if (licenseStatus && licenseTypes) lines.push(`Licences: ${licenseStatus} — ${licenseTypes}`);
    else if (licenseStatus) lines.push(`Licences: ${licenseStatus}`);
    else lines.push(`Licences: ${licenseTypes}`);
  }

  return lines;
}

function buildStageLines(bookings: MomVenueBooking[], eventReqs: Record<string, unknown>): string[] {
  if (bookings.length <= 1) {
    const reqs = bookings[0] ? resolveVenueRequirements(bookings[0], eventReqs) : eventReqs;
    return buildStageLinesForReqs(reqs);
  }
  const lines: string[] = [];
  for (const booking of bookings) {
    const reqs = resolveVenueRequirements(booking, eventReqs);
    lines.push(...withVenuePrefix(booking.venue, buildStageLinesForReqs(reqs)), "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : [TBC];
}

function buildStageLinesForReqs(reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const stage = text(reqs.stage_setup);
  if (stage) lines.push(stage);

  const greenRooms = text(reqs.green_rooms_required);
  const greenAmenities = text(reqs.green_room_amenities);
  if (greenRooms || greenAmenities) {
    lines.push(
      `Green rooms: ${greenRooms ?? TBC}${greenAmenities ? ` — ${greenAmenities}` : ""}`
    );
  }

  const piano = yesNoLine("Piano", reqs.piano_required, reqs.piano_tuning_time ? `tuning ${formatMomTime(text(reqs.piano_tuning_time))}` : null);
  if (piano) lines.push(piano);

  const pit = yesNoLine("Orchestra pit chairs", reqs.orchestra_pit_chairs, reqs.orchestra_pit_chairs_note);
  if (pit) lines.push(pit);

  const telecast = yesNoLine("Telecasting / Media", reqs.telecasting_media, reqs.telecasting_media_note);
  if (telecast) lines.push(telecast);

  return lines.length > 0 ? lines : [TBC];
}

function buildFoyerLines(bookings: MomVenueBooking[], eventReqs: Record<string, unknown>): string[] {
  if (bookings.length <= 1) {
    const reqs = bookings[0] ? resolveVenueRequirements(bookings[0], eventReqs) : eventReqs;
    return buildFoyerLinesForReqs(reqs);
  }
  const lines: string[] = [];
  for (const booking of bookings) {
    const reqs = resolveVenueRequirements(booking, eventReqs);
    lines.push(...withVenuePrefix(booking.venue, buildFoyerLinesForReqs(reqs)), "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : [TBC];
}

function buildFoyerLinesForReqs(reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const foyer = text(reqs.foyer_setup);
  if (foyer) lines.push(foyer);
  const standee = yesNoLine("Digital standee", reqs.digital_standee, reqs.digital_standee_note);
  if (standee) lines.push(standee);
  const stalls = yesNoLine("Stalls", reqs.stalls, reqs.stalls_note);
  if (stalls) lines.push(stalls);
  const car = yesNoLine("Car display", reqs.car_display, reqs.car_display_note);
  if (car) lines.push(car);
  const bike = yesNoLine("Bike display", reqs.bike_display, reqs.bike_display_note);
  if (bike) lines.push(bike);
  return lines.length > 0 ? lines : [TBC];
}

function buildSecurityLines(bookings: MomVenueBooking[], eventReqs: Record<string, unknown>): string[] {
  if (bookings.length <= 1) {
    const reqs = bookings[0] ? resolveVenueRequirements(bookings[0], eventReqs) : eventReqs;
    return buildSecurityLinesForReqs(reqs);
  }
  const lines: string[] = [];
  for (const booking of bookings) {
    const reqs = resolveVenueRequirements(booking, eventReqs);
    lines.push(...withVenuePrefix(booking.venue, buildSecurityLinesForReqs(reqs)), "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : [TBC];
}

function buildSecurityLinesForReqs(reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const parking = text(reqs.parking);
  const security = text(reqs.security);
  if (parking) lines.push(parking);
  if (security) lines.push(security);
  return lines.length > 0 ? lines : [TBC];
}

function buildHousekeepingLines(bookings: MomVenueBooking[], eventReqs: Record<string, unknown>): string[] {
  if (bookings.length <= 1) {
    const reqs = bookings[0] ? resolveVenueRequirements(bookings[0], eventReqs) : eventReqs;
    return buildHousekeepingLinesForReqs(reqs);
  }
  const lines: string[] = [];
  for (const booking of bookings) {
    const reqs = resolveVenueRequirements(booking, eventReqs);
    lines.push(...withVenuePrefix(booking.venue, buildHousekeepingLinesForReqs(reqs)), "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : [TBC];
}

function buildHousekeepingLinesForReqs(reqs: Record<string, unknown>): string[] {
  const hk = text(reqs.housekeeping);
  return hk ? [hk] : [TBC];
}

function buildProgramOfficerLines(input: MomEventInput, reqs: Record<string, unknown>): string[] {
  const name = text(input.program_officer);
  const phone = text(reqs.program_officer_phone);
  if (!name && !phone) return [TBC];
  if (name && phone) return [`Program officer for the event: – ${name} – ${phone}.`];
  if (name) return [`Program officer for the event: – ${name}.`];
  return [`Program officer contact: – ${phone}.`];
}

function headline(input: MomEventInput): string {
  const org = text(input.organisation_name) ?? TBC;
  const title = text(input.title) ?? TBC;
  const venues = (input.venue_bookings ?? [])
    .map((b) => text(b.venue))
    .filter((v): v is string => Boolean(v));
  const venueLabel = venues.length > 0 ? venues.join(", ") : TBC;
  const dateLabel = formatMomLongDate(input.event_start_date);
  return `Venue for Hire Event - ${org} - ${title} at ${venueLabel} on ${dateLabel}.`;
}

type MomSectionBlock = { title: string; lines: string[] };

function buildMomSectionBlocks(input: MomEventInput): { headline: string; sections: MomSectionBlock[] } {
  const eventReqs = parseRequirements(input.requirements);
  const reqs = aggregateMomRequirements(input);
  const bookings = input.venue_bookings ?? [];
  return {
    headline: headline(input),
    sections: [
      { title: "Nature of the event: -", lines: buildNatureLines(input, reqs) },
      { title: "Timings: -", lines: buildTimingLines(bookings) },
      { title: "Guest Arrival & Event: -", lines: buildGuestLines(bookings, eventReqs) },
      { title: "Vendors: -", lines: buildVendorLines(bookings, eventReqs) },
      { title: "Setup on Stage: -", lines: buildStageLines(bookings, eventReqs) },
      { title: "Foyer: -", lines: buildFoyerLines(bookings, eventReqs) },
      { title: "Security: -", lines: buildSecurityLines(bookings, eventReqs) },
      { title: "Housekeeping: -", lines: buildHousekeepingLines(bookings, eventReqs) },
      { title: "Program Officer: -", lines: buildProgramOfficerLines(input, eventReqs) },
    ],
  };
}

/** Auto MoM body through Program Officer (no custom block). Plain-text fallback. */
export function buildMomAutoText(input: MomEventInput): string {
  const { headline: head, sections } = buildMomSectionBlocks(input);
  const parts = [
    head,
    "",
    "Details of the event:",
    "",
    ...sections.flatMap((block) => [section(block.title, block.lines), ""]),
  ];
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Full MoM including customised block (everything after Program Officer). Plain-text fallback. */
export function buildMomDocument(input: MomEventInput, customNotes?: string | null): string {
  const auto = buildMomAutoText(input).trimEnd();
  const custom = text(customNotes);
  if (!custom) return `${auto}\n`;
  return `${auto}\n\n---\nAdditional / undecided items:\n${custom}\n`;
}

export function momMissingFieldsMessage(missing: MomMissingField[]): string {
  if (missing.length === 0) return "";
  const first = missing[0]!;
  if (missing.length === 1) {
    return `${first.label} is not filled. Do you want to continue?`;
  }
  if (missing.length === 2) {
    const second = missing[1]!;
    return `${first.label} and ${second.label} are not filled. Do you want to continue?`;
  }
  const head = missing.slice(0, -1).map((f) => f.label).join(", ");
  const last = missing[missing.length - 1]!;
  return `${head}, and ${last.label} are not filled. Do you want to continue?`;
}

function renderMomLinesHtml(lines: string[]): string {
  const body = lines.length > 0 ? lines : [TBC];
  return body
    .map((line) => {
      if (line === "") {
        return `<div style="height:8px;line-height:8px;font-size:8px;">&nbsp;</div>`;
      }
      return `<div style="margin:0 0 2pt 0;">${escapeHtml(line)}</div>`;
    })
    .join("");
}

/**
 * Rich HTML fragment for client email / Word / on-screen preview.
 * Uses inline styles so paste into Outlook/Gmail keeps hierarchy.
 */
export function buildMomDocumentHtml(input: MomEventInput, customNotes?: string | null): string {
  const { headline: head, sections } = buildMomSectionBlocks(input);
  const sectionsHtml = sections
    .map(
      (block) =>
        `<div style="margin:0 0 14pt 0;">` +
        `<div style="font-weight:700;text-decoration:underline;margin:0 0 6pt 0;">${escapeHtml(block.title)}</div>` +
        renderMomLinesHtml(block.lines) +
        `</div>`,
    )
    .join("");

  const custom = text(customNotes);
  const customHtml = custom
    ? `<div style="margin:18pt 0 0 0;padding-top:12pt;border-top:1px solid #c9c2b8;">` +
      `<div style="font-weight:700;text-decoration:underline;margin:0 0 6pt 0;">Additional / undecided items:</div>` +
      renderMomLinesHtml(custom.split("\n")) +
      `</div>`
    : "";

  return (
    `<div style="font-family:Georgia,'Times New Roman',serif;color:#2f2c27;font-size:11pt;line-height:1.45;">` +
    `<div style="font-weight:700;font-size:12.5pt;margin:0 0 14pt 0;">${escapeHtml(head)}</div>` +
    `<div style="font-weight:700;text-decoration:underline;margin:0 0 12pt 0;">Details of the event:</div>` +
    sectionsHtml +
    customHtml +
    `</div>`
  );
}

/** Full printable / PDF HTML page with professional MoM formatting. */
export function buildMomHtml(
  input: MomEventInput,
  title: string,
  customNotes?: string | null,
): string {
  const body = buildMomDocumentHtml(input, customNotes);
  return buildPrintablePageHtml({
    title,
    bodyHtml: `<div class="mom-document">${body}</div>`,
  });
}
