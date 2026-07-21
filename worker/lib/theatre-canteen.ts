import { CATERING_MEAL_TYPES, cateringMealPaxKey, cateringMealRequiredKey, isCateringMealRequired } from "./catering-meals";
import { countScheduledShowsByDate, type ShowScheduleEntryLike } from "./show-schedule";

/** Fixed venue caterer — not selected per event. */
export const THEATRE_CANTEEN_LABEL = "Theatre canteen (NCPA)";

export const THEATRE_CANTEEN_REQUIRED_KEY = "theatre_canteen_required";
export const SIT_DOWN_MEALS_REQUIRED_KEY = "sit_down_meals_required";
export const CANTEEN_BEFORE_SHOW_KEY = "canteen_before_show";
export const CANTEEN_IN_INTERVAL_KEY = "canteen_in_interval";
export const CANTEEN_BETWEEN_SHOWS_KEY = "canteen_between_shows";

export const CANTEEN_TIMING_KEYS = [
  CANTEEN_BEFORE_SHOW_KEY,
  CANTEEN_IN_INTERVAL_KEY,
  CANTEEN_BETWEEN_SHOWS_KEY,
] as const;

export const CANTEEN_TIMING_NOT_APPLICABLE = "N/A";

export type CanteenTimingKey = (typeof CANTEEN_TIMING_KEYS)[number];

export type VenueScheduleLike = {
  schedule_entries?: readonly ShowScheduleEntryLike[] | null;
  number_of_shows?: number | null;
};

const text = (value: unknown): string => String(value ?? "").trim();
const lower = (value: unknown): string => text(value).toLowerCase();

export function isAffirmativeYes(value: unknown): boolean {
  return ["yes", "required", "keep"].includes(lower(value));
}

export function isExplicitNo(value: unknown): boolean {
  return ["no", "not required", "remove"].includes(lower(value));
}

export function isTheatreCanteenRequired(values: Record<string, unknown>): boolean {
  return isAffirmativeYes(values[THEATRE_CANTEEN_REQUIRED_KEY]);
}

export function isSitDownMealsRequired(values: Record<string, unknown>): boolean {
  return isAffirmativeYes(values[SIT_DOWN_MEALS_REQUIRED_KEY]);
}

export function isCanteenTimingApplicable(value: unknown): boolean {
  return isAffirmativeYes(value);
}

export function isCanteenTimingNotApplicable(value: unknown): boolean {
  return lower(value) === lower(CANTEEN_TIMING_NOT_APPLICABLE);
}

export function hasSitDownMealCaptured(values: Record<string, unknown>): boolean {
  for (const meal of CATERING_MEAL_TYPES) {
    if (isCateringMealRequired(values[cateringMealRequiredKey(meal.key)])) return true;
    if (text(values[cateringMealPaxKey(meal.key)])) return true;
  }
  return false;
}

export function isBetweenShowsCanteenApplicable(venues: readonly VenueScheduleLike[]): boolean {
  for (const venue of venues) {
    const byDate = countScheduledShowsByDate(venue.schedule_entries);
    if ([...byDate.values()].some((count) => count > 1)) return true;
    if (byDate.size === 0 && Math.max(0, Number(venue.number_of_shows) || 0) > 1) return true;
  }
  return false;
}

export function isBetweenShowsCanteenApplicableForEntries(
  entries: readonly ShowScheduleEntryLike[] | null | undefined,
  legacyShowCount?: number | null,
): boolean {
  return isBetweenShowsCanteenApplicable([{ schedule_entries: entries, number_of_shows: legacyShowCount }]);
}

export function activeCanteenTimingKeys(
  values: Record<string, unknown>,
  venues: readonly VenueScheduleLike[],
): CanteenTimingKey[] {
  if (!isTheatreCanteenRequired(values)) return [];
  const keys: CanteenTimingKey[] = [CANTEEN_BEFORE_SHOW_KEY, CANTEEN_IN_INTERVAL_KEY];
  if (isBetweenShowsCanteenApplicable(venues)) keys.push(CANTEEN_BETWEEN_SHOWS_KEY);
  return keys;
}

export function theatreCanteenTimingsFilled(values: Record<string, unknown>): boolean {
  return CANTEEN_TIMING_KEYS.some((key) => {
    if (isCanteenTimingNotApplicable(values[key])) return false;
    return isAffirmativeYes(values[key]) || isExplicitNo(values[key]);
  }) && CANTEEN_TIMING_KEYS.some((key) => isAffirmativeYes(values[key]));
}

export function theatreCanteenTimingsFilledForVenues(
  values: Record<string, unknown>,
  venues: readonly VenueScheduleLike[],
): boolean {
  const keys = activeCanteenTimingKeys(values, venues);
  if (keys.length === 0) return true;
  return keys.every((key) => isAffirmativeYes(values[key]) || isExplicitNo(values[key]))
    && keys.some((key) => isAffirmativeYes(values[key]));
}

export function isCateringSectionNotApplicable(values: Record<string, unknown>): boolean {
  return isExplicitNo(values[THEATRE_CANTEEN_REQUIRED_KEY]) && isExplicitNo(values[SIT_DOWN_MEALS_REQUIRED_KEY]);
}

/** Map legacy catering_required / interval into the split model for display and readiness. */
export function normalizeCateringRequirements(reqs: Record<string, unknown>): Record<string, unknown> {
  const out = { ...reqs };
  const hasNewGates = out[THEATRE_CANTEEN_REQUIRED_KEY] != null || out[SIT_DOWN_MEALS_REQUIRED_KEY] != null;
  if (!hasNewGates) {
    if (isExplicitNo(out.catering_required)) {
      out[THEATRE_CANTEEN_REQUIRED_KEY] = "No";
      out[SIT_DOWN_MEALS_REQUIRED_KEY] = "No";
    } else if (isAffirmativeYes(out.catering_required)) {
      const meals = hasSitDownMealCaptured(out) || Boolean(text(out.catering_provider));
      out[SIT_DOWN_MEALS_REQUIRED_KEY] = meals ? "Yes" : "No";
      const canteen = isAffirmativeYes(out.interval);
      out[THEATRE_CANTEEN_REQUIRED_KEY] = canteen ? "Yes" : (meals ? "No" : "No");
      if (canteen && !out[CANTEEN_IN_INTERVAL_KEY]) out[CANTEEN_IN_INTERVAL_KEY] = "Yes";
    }
  } else if (isAffirmativeYes(out.interval) && !out[CANTEEN_IN_INTERVAL_KEY]) {
    out[THEATRE_CANTEEN_REQUIRED_KEY] = out[THEATRE_CANTEEN_REQUIRED_KEY] ?? "Yes";
    out[CANTEEN_IN_INTERVAL_KEY] = "Yes";
  }

  if (!isBetweenShowsCanteenApplicableForEntries(null, null) && out[CANTEEN_BETWEEN_SHOWS_KEY] == null) {
    // Caller may still set N/A when rendering a single venue without schedule context.
  }

  return out;
}

export function formatCanteenTimingSummary(values: Record<string, unknown>, betweenShowsApplicable: boolean): string | null {
  if (!isTheatreCanteenRequired(values)) return null;
  const parts: string[] = [];
  const labels: Record<CanteenTimingKey, string> = {
    [CANTEEN_BEFORE_SHOW_KEY]: "Before show",
    [CANTEEN_IN_INTERVAL_KEY]: "In interval",
    [CANTEEN_BETWEEN_SHOWS_KEY]: "Between shows",
  };
  for (const key of CANTEEN_TIMING_KEYS) {
    if (key === CANTEEN_BETWEEN_SHOWS_KEY && !betweenShowsApplicable) {
      if (isCanteenTimingNotApplicable(values[key])) parts.push(`${labels[key]}: N/A`);
      continue;
    }
    if (isAffirmativeYes(values[key])) parts.push(`${labels[key]}: Yes`);
    else if (isExplicitNo(values[key])) parts.push(`${labels[key]}: No`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}
