/**
 * Date helpers for the Organisations page (banner window + recency facets).
 *
 * The project uses the native Date API throughout (no date-fns/dayjs). These
 * ports/extracts the previously-unexported helpers from CalendarPage.tsx so the
 * faceted page can compute "same time last year" windows and recency buckets
 * without touching the calendar code.
 */

/** Add `n` days to `d`, returning a NEW Date (does not mutate input). */
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Add `n` months to `d`, returning a NEW Date. Clamps end-of-month as JS does. */
export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

/** Midnight of the Sunday-starting week containing `d` (matches CalendarPage). */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** First day of the month containing `d` at midnight. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** First day of the calendar quarter containing `d` (Jan/Apr/Jul/Oct 1). */
export function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3) * 3; // 0, 3, 6, 9
  return new Date(d.getFullYear(), q, 1);
}

/** Format a Date as `yyyy-mm-dd` (no timezone shift). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * True iff `iso` falls within [fromIso, toIso] inclusive. Any of the inputs may
 * be `null` (returns false when iso is null; open-ended when bounds are null).
 */
export function withinRange(
  iso: string | null | undefined,
  fromIso: string | null,
  toIso: string | null,
): boolean {
  if (!iso) return false;
  if (fromIso && iso < fromIso) return false;
  if (toIso && iso > toIso) return false;
  return true;
}

/**
 * The "same time last year" target date: today shifted forward one month, then
 * back one full year. e.g. today 2026-07-05 → target 2025-08-05.
 */
export function bannerTarget(today: Date = new Date()): Date {
  return addMonths(addMonths(today, 1), -12);
}

/**
 * Map an activity timestamp to one of the four recency buckets the facet shows.
 * Returns `null` when there's no timestamp (counts as "unknown", not inactive).
 */
export function recencyBucket(
  iso: string | null | undefined,
  now: Date = new Date(),
): "week" | "month" | "quarter" | "inactive6" | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const week = startOfWeek(now).getTime();
  const month = startOfMonth(now).getTime();
  const quarter = startOfQuarter(now).getTime();
  const sixMonthsAgo = addMonths(now, -6).getTime();
  if (t >= week) return "week";
  if (t >= month) return "month";
  if (t >= quarter) return "quarter";
  if (t < sixMonthsAgo) return "inactive6";
  return null; // between quarter-start and 6 months ago — no matching chip
}
