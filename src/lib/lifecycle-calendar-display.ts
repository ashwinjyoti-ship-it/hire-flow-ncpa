/**
 * The lifecycle month grid already surfaces the actual step chips and overflow
 * count, so a per-day total badge just adds noise.
 */
export function shouldShowLifecycleStepCountBadge(): boolean {
  return false;
}
