import type { ScheduleDayInputT, ScheduleEntryInputT } from "./types";

type DailyTimingFields = Pick<
  ScheduleDayInputT,
  | "with_ac_start"
  | "with_ac_end"
  | "with_ac_minutes"
  | "without_ac_start"
  | "without_ac_end"
  | "without_ac_minutes"
>;

const EMPTY_DAILY_TIMINGS: DailyTimingFields = {
  with_ac_start: null,
  with_ac_end: null,
  with_ac_minutes: null,
  without_ac_start: null,
  without_ac_end: null,
  without_ac_minutes: null,
};

function timingFieldsFromEntry(entry: ScheduleEntryInputT): DailyTimingFields {
  return {
    with_ac_start: entry.with_ac_start ?? null,
    with_ac_end: entry.with_ac_end ?? null,
    with_ac_minutes: entry.with_ac_minutes ?? null,
    without_ac_start: entry.without_ac_start ?? null,
    without_ac_end: entry.without_ac_end ?? null,
    without_ac_minutes: entry.without_ac_minutes ?? null,
  };
}

function fillMissingTimings(current: DailyTimingFields, entry: ScheduleEntryInputT): DailyTimingFields {
  const candidate = timingFieldsFromEntry(entry);
  return {
    with_ac_start: current.with_ac_start ?? candidate.with_ac_start,
    with_ac_end: current.with_ac_end ?? candidate.with_ac_end,
    with_ac_minutes: current.with_ac_minutes ?? candidate.with_ac_minutes,
    without_ac_start: current.without_ac_start ?? candidate.without_ac_start,
    without_ac_end: current.without_ac_end ?? candidate.without_ac_end,
    without_ac_minutes: current.without_ac_minutes ?? candidate.without_ac_minutes,
  };
}

/**
 * Builds one venue-day timing record for each activity date. Legacy schedules
 * stored these fields on every activity, so the first populated value for each
 * field becomes the shared daily window.
 */
export function deriveScheduleDaysFromEntries(entries: ScheduleEntryInputT[]): ScheduleDayInputT[] {
  const days = new Map<string, ScheduleDayInputT>();
  for (const entry of entries) {
    if (!entry.activity_date) continue;
    const existing = days.get(entry.activity_date);
    if (!existing) {
      days.set(entry.activity_date, {
        activity_date: entry.activity_date,
        ...fillMissingTimings(EMPTY_DAILY_TIMINGS, entry),
      });
      continue;
    }
    days.set(entry.activity_date, {
      ...existing,
      ...fillMissingTimings(existing, entry),
    });
  }
  return Array.from(days.values()).sort((a, b) => a.activity_date.localeCompare(b.activity_date));
}

/** Mirror the shared venue-day window onto each activity for legacy readers. */
export function applyScheduleDaysToEntries(
  entries: ScheduleEntryInputT[],
  suppliedDays?: ScheduleDayInputT[] | null,
): ScheduleEntryInputT[] {
  const days = suppliedDays?.length ? suppliedDays : deriveScheduleDaysFromEntries(entries);
  const byDate = new Map(days.map((day) => [day.activity_date, day]));
  return entries.map((entry) => {
    const day = byDate.get(entry.activity_date);
    if (!day) return entry;
    return {
      ...entry,
      with_ac_start: day.with_ac_start ?? null,
      with_ac_end: day.with_ac_end ?? null,
      with_ac_minutes: day.with_ac_minutes ?? null,
      without_ac_start: day.without_ac_start ?? null,
      without_ac_end: day.without_ac_end ?? null,
      without_ac_minutes: day.without_ac_minutes ?? null,
    };
  });
}
