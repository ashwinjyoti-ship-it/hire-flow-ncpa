/**
 * Minutes of Meeting (MoM) generator — compiles an event record into the
 * email-style operational MoM used by Venue for Hire.
 *
 * Auto-generated content runs through Program Officer. Everything after that
 * comes from the caller's customised notes block (Technical Officer, etc.).
 * Empty sections / lines render as "TBC".
 */

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
  const reqs = parseRequirements(input.requirements);
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

  if (isYes(reqs.catering_required, "Yes")) {
    push("catering_provider", "Caterer", filled(reqs.catering_provider));
    push("interval", "Interval", filled(reqs.interval));
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

function buildGuestLines(bookings: MomVenueBooking[], reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const totalShows = bookings.reduce((sum, b) => sum + (Number(b.number_of_shows) || 0), 0);
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

function buildVendorLines(reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];

  if (isYes(reqs.catering_required, "Yes")) {
    const caterer = text(reqs.catering_provider) ?? TBC;
    const pax = text(reqs.no_of_pax);
    const interval = text(reqs.interval);
    let catererLine = `Caterer - ${caterer}`;
    if (pax) catererLine += ` (${pax} pax)`;
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

  return lines;
}

function buildStageLines(reqs: Record<string, unknown>): string[] {
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

function buildFoyerLines(reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];
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

function buildSecurityLines(reqs: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const parking = text(reqs.parking);
  const security = text(reqs.security);
  if (parking) lines.push(parking);
  if (security) lines.push(security);
  return lines.length > 0 ? lines : [TBC];
}

function buildHousekeepingLines(reqs: Record<string, unknown>): string[] {
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

/** Auto MoM body through Program Officer (no custom block). */
export function buildMomAutoText(input: MomEventInput): string {
  const reqs = parseRequirements(input.requirements);
  const bookings = input.venue_bookings ?? [];

  const parts = [
    headline(input),
    "",
    "Details of the event:",
    "",
    section("Nature of the event: -", buildNatureLines(input, reqs)),
    "",
    section("Timings: -", buildTimingLines(bookings)),
    "",
    section("Guest Arrival & Event: -", buildGuestLines(bookings, reqs)),
    "",
    section("Vendors: -", buildVendorLines(reqs)),
    "",
    section("Setup on Stage: -", buildStageLines(reqs)),
    "",
    section("Foyer: -", buildFoyerLines(reqs)),
    "",
    section("Security: -", buildSecurityLines(reqs)),
    "",
    section("Housekeeping: -", buildHousekeepingLines(reqs)),
    "",
    section("Program Officer: -", buildProgramOfficerLines(input, reqs)),
  ];

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Full MoM including customised block (everything after Program Officer). */
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

export function buildMomHtml(documentText: string, title: string): string {
  const escaped = documentText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${title.replace(/</g, "")}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #2f2c27; margin: 32px; white-space: pre-wrap; line-height: 1.45; font-size: 12pt; }
  .toolbar { margin-bottom: 16px; }
  .toolbar button { font: inherit; padding: 6px 16px; }
  @media print { .toolbar { display: none; } body { margin: 12px; } }
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
<pre style="font: inherit; white-space: pre-wrap; margin: 0;">${escaped}</pre>
</body></html>`;
}
