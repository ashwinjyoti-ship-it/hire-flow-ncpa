/** Meal types captured on the event form when catering is required. */
export const CATERING_MEAL_TYPES = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "snack_box", label: "Snack box" },
  { key: "hi_tea", label: "Hi-Tea" },
  { key: "dinner", label: "Dinner" },
] as const;

export type CateringMealKey = (typeof CATERING_MEAL_TYPES)[number]["key"];

export function cateringMealRequiredKey(mealKey: CateringMealKey): string {
  return `catering_${mealKey}_required`;
}

export function cateringMealPaxKey(mealKey: CateringMealKey): string {
  return `catering_${mealKey}_pax`;
}

export const CATERING_MEAL_PAX_KEYS = new Set(
  CATERING_MEAL_TYPES.map((meal) => cateringMealPaxKey(meal.key)),
);

export function isCateringMealPaxKey(key: string): boolean {
  return CATERING_MEAL_PAX_KEYS.has(key);
}

/** Stored on the event form when a meal is not needed for this event. */
export const CATERING_MEAL_NOT_APPLICABLE = "N/A";

const MEAL_NOT_APPLICABLE_VALUES = new Set([
  "",
  "n/a",
  "n.a.",
  "not applicable",
  "no applicable",
  "no",
]);

/** Whether this meal applies — only explicit Yes activates pax and readiness checks. */
export function isCateringMealRequired(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "yes";
}

/** Whether the meal row is settled (N/A / No / empty default) and needs no lifecycle action. */
export function isCateringMealNotApplicable(value: unknown): boolean {
  return MEAL_NOT_APPLICABLE_VALUES.has(String(value ?? "").trim().toLowerCase());
}
