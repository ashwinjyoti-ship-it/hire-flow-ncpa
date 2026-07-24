/** Default for optional sub-rows on the event form (meals, staffing toggles, add-ons). */
export const OPTIONAL_NOT_APPLICABLE = "N/A";

/** Legacy stored negatives treated as N/A for readiness and UI (documented: N/A = No). */
const LEGACY_NOT_APPLICABLE_VALUES = new Set([
  "no",
  "not required",
  "keep",
]);

const SETTLED_VALUES = new Set([
  "",
  "n/a",
  "n.a.",
  "not applicable",
  "no applicable",
  ...LEGACY_NOT_APPLICABLE_VALUES,
]);

const AFFIRMATIVE_VALUES = new Set(["yes", "required", "remove"]);

export function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

export function isOptionalAffirmative(value: unknown): boolean {
  return AFFIRMATIVE_VALUES.has(textValue(value).toLowerCase());
}

/** Untouched / N/A / legacy No — no lifecycle action required for this row. */
export function isOptionalSettled(value: unknown): boolean {
  return SETTLED_VALUES.has(textValue(value).toLowerCase());
}

/** Dropdown display: affirmative values as stored; everything else shows N/A. */
export function optionalDisplayValue(value: unknown): string {
  if (isOptionalAffirmative(value)) return textValue(value);
  return OPTIONAL_NOT_APPLICABLE;
}

export function optionalDetailFilled(value: unknown): boolean {
  return textValue(value).length > 0;
}

/** Every affirmative toggle in the group has its detail fields filled. */
export function optionalGroupDetailsFilled(
  values: Record<string, unknown>,
  pairs: Array<{ toggle: string; details: string[] }>,
): boolean {
  for (const { toggle, details } of pairs) {
    if (!isOptionalAffirmative(values[toggle])) continue;
    if (!details.every((key) => optionalDetailFilled(values[key]))) return false;
  }
  return true;
}

/** Section is not applicable when no optional row is affirmative. */
export function optionalGroupNotApplicable(
  values: Record<string, unknown>,
  toggleKeys: string[],
): boolean {
  return toggleKeys.every((key) => !isOptionalAffirmative(values[key]));
}
