import { formatActivityType } from "./types";

export type ScheduleTimingRow = {
  venue: string;
  activity_type: string;
  activity_date: string;
  start_time?: string | null;
  end_time?: string | null;
  with_ac_start?: string | null;
  with_ac_end?: string | null;
  with_ac_minutes?: number | null;
  without_ac_start?: string | null;
  without_ac_end?: string | null;
  without_ac_minutes?: number | null;
  notes?: string | null;
  sort_order?: number | null;
};

function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const [sh = 0, sm = 0] = start.split(":").map(Number);
  const [eh = 0, em = 0] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

function resolveMinutes(
  stored: number | null | undefined,
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (stored != null && stored > 0) return stored;
  return minutesBetween(start, end);
}

export function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  return `${start}-${end}`;
}

function sortRows(rows: ScheduleTimingRow[]): ScheduleTimingRow[] {
  return [...rows].sort((a, b) =>
    a.venue.localeCompare(b.venue)
    || String(a.activity_date).localeCompare(String(b.activity_date))
    || (a.sort_order ?? 0) - (b.sort_order ?? 0)
    || String(a.start_time ?? "").localeCompare(String(b.start_time ?? "")),
  );
}

function buildWindowLines(
  rows: ScheduleTimingRow[],
  window: "with_ac" | "without_ac",
): string | null {
  const lines: string[] = [];
  let currentVenue: string | null = null;

  for (const row of sortRows(rows)) {
    const start = window === "with_ac" ? row.with_ac_start : row.without_ac_start;
    const end = window === "with_ac" ? row.with_ac_end : row.without_ac_end;
    const mins = resolveMinutes(
      window === "with_ac" ? row.with_ac_minutes : row.without_ac_minutes,
      start,
      end,
    );
    if (!start || !end || mins == null) continue;

    if (row.venue !== currentVenue) {
      if (lines.length > 0) lines.push("");
      lines.push(`[${row.venue}]`);
      currentVenue = row.venue;
    }

    const activity = formatActivityType(row.activity_type);
    const activityWindow = formatTimeRange(row.start_time, row.end_time);
    const header = activityWindow
      ? `${activity}, ${row.activity_date}: ${activityWindow}`
      : `${activity}, ${row.activity_date}`;
    const label = window === "with_ac" ? "With AC" : "Without AC";
    lines.push(`${header}`);
    lines.push(`  ${label}: ${start}-${end} (${formatDurationMinutes(mins)})`);
    const note = row.notes?.trim();
    if (note) lines.push(`  Note: ${note}`);
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines.join("\n") : null;
}

export function buildTimingsWithAcText(rows: ScheduleTimingRow[]): string | null {
  return buildWindowLines(rows, "with_ac");
}

export function buildTimingsWithoutAcText(rows: ScheduleTimingRow[]): string | null {
  return buildWindowLines(rows, "without_ac");
}

export function sumAcMinutes(rows: ScheduleTimingRow[]): number {
  let total = 0;
  for (const row of rows) {
    const mins = resolveMinutes(row.with_ac_minutes, row.with_ac_start, row.with_ac_end);
    if (mins != null) total += mins;
  }
  return total;
}

export function sumWithoutAcMinutes(rows: ScheduleTimingRow[]): number {
  let total = 0;
  for (const row of rows) {
    const mins = resolveMinutes(row.without_ac_minutes, row.without_ac_start, row.without_ac_end);
    if (mins != null) total += mins;
  }
  return total;
}

export function formatHoursTotal(minutes: number): string {
  if (minutes <= 0) return "—";
  return formatDurationMinutes(minutes);
}
