/**
 * The lifecycle month grid already surfaces the actual step chips and overflow
 * count, so a per-day total badge just adds noise.
 */
import { usableShowDate } from "../../worker/lib/event-date-policy";

export const NO_DATE_OF_SHOW_LABEL = "No date of show";
export const NO_DATE_OF_SHOW_CHIP = "No date";

export function shouldShowLifecycleStepCountBadge(): boolean {
  return false;
}

export function showDateMissing(value: string | null | undefined): boolean {
  return !usableShowDate(value);
}

export function showDateMissingLabel(compact = false): string {
  return compact ? NO_DATE_OF_SHOW_CHIP : NO_DATE_OF_SHOW_LABEL;
}
