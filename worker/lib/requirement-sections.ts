import { CATERING_MEAL_TYPES, cateringMealPaxKey, cateringMealRequiredKey } from "./catering-meals";
import {
  isSitDownMealsRequired,
  isTheatreCanteenRequired,
  normalizeCateringRequirements,
} from "./theatre-canteen";

/** Checklist rows — one per event form Requirements card. */
export const EXECUTION_SECTIONS = [
  { fieldKey: "exec_sound_light", label: "Sound & Light" },
  { fieldKey: "exec_staffing", label: "Staffing & Facilities" },
  { fieldKey: "exec_recording_special", label: "Recording & Special" },
  { fieldKey: "exec_catering_decorator", label: "Catering / Decorator" },
  { fieldKey: "exec_operations", label: "Operations" },
  { fieldKey: "exec_additional", label: "Additional Requirements" },
] as const;

export type ExecutionSectionFieldKey = (typeof EXECUTION_SECTIONS)[number]["fieldKey"];

export const EXECUTION_SECTION_STATUS = {
  notStarted: "Not started",
  captured: "Captured on form",
  verified: "Verified",
  notApplicable: "Not applicable",
} as const;

export const EXECUTION_SECTION_OPTIONS = [
  EXECUTION_SECTION_STATUS.notStarted,
  EXECUTION_SECTION_STATUS.captured,
  EXECUTION_SECTION_STATUS.verified,
  EXECUTION_SECTION_STATUS.notApplicable,
] as const;

const AFFIRMATIVE = new Set(["yes", "required", "keep"]);

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s.length ? s : null;
}

function isAffirmative(v: unknown): boolean {
  const s = str(v);
  return s != null && AFFIRMATIVE.has(s.toLowerCase());
}

function hasMeaningfulText(v: unknown): boolean {
  return str(v) != null;
}

function hasMealCaptured(reqs: Record<string, unknown>): boolean {
  for (const meal of CATERING_MEAL_TYPES) {
    if (isAffirmative(reqs[cateringMealRequiredKey(meal.key)])) return true;
    if (hasMeaningfulText(reqs[cateringMealPaxKey(meal.key)])) return true;
  }
  return false;
}

/** True when the form carries real content for this section (not placeholder defaults alone). */
export function isExecutionSectionCaptured(fieldKey: ExecutionSectionFieldKey, reqs: Record<string, unknown>): boolean {
  const values = normalizeCateringRequirements(reqs);
  switch (fieldKey) {
    case "exec_sound_light":
      return hasMeaningfulText(reqs.sound)
        || hasMeaningfulText(reqs.light)
        || hasMeaningfulText(reqs.sound_call_time)
        || hasMeaningfulText(reqs.light_call_time);
    case "exec_staffing":
      return isAffirmative(reqs.green_rooms_required)
        || hasMeaningfulText(reqs.green_room_amenities)
        || isAffirmative(reqs.ushers_required)
        || hasMeaningfulText(reqs.ushers_call_time)
        || isAffirmative(reqs.loaders_required)
        || hasMeaningfulText(reqs.loaders_call_time)
        || isAffirmative(reqs.house_seats_release)
        || hasMeaningfulText(reqs.house_tickets);
    case "exec_recording_special":
      return isAffirmative(reqs.video_recording)
        || hasMeaningfulText(reqs.camera_count)
        || hasMeaningfulText(reqs.recording_type)
        || isAffirmative(reqs.piano_required)
        || hasMeaningfulText(reqs.piano_tuning_time)
        || isAffirmative(reqs.liquor_licence)
        || hasMeaningfulText(reqs.liquor_licence_details);
    case "exec_catering_decorator":
      return isTheatreCanteenRequired(values)
        || isSitDownMealsRequired(values)
        || hasMeaningfulText(values.canteen_before_show)
        || hasMeaningfulText(values.canteen_in_interval)
        || hasMeaningfulText(values.canteen_between_shows)
        || hasMeaningfulText(values.catering_provider)
        || hasMealCaptured(values)
        || isAffirmative(values.decorator_required)
        || hasMeaningfulText(values.decorator_name);
    case "exec_operations":
      return hasMeaningfulText(reqs.parking)
        || hasMeaningfulText(reqs.security)
        || hasMeaningfulText(reqs.housekeeping)
        || hasMeaningfulText(reqs.crew_cards)
        || ["received", "awaiting"].includes(str(reqs.licenses_status)?.toLowerCase() ?? "")
        || hasMeaningfulText(reqs.licenses);
    case "exec_additional":
      return isAffirmative(reqs.orchestra_pit_chairs)
        || hasMeaningfulText(reqs.orchestra_pit_chairs_note)
        || isAffirmative(reqs.digital_standee)
        || hasMeaningfulText(reqs.digital_standee_note)
        || isAffirmative(reqs.car_display)
        || hasMeaningfulText(reqs.car_display_note)
        || isAffirmative(reqs.bike_display)
        || hasMeaningfulText(reqs.bike_display_note)
        || isAffirmative(reqs.stalls)
        || hasMeaningfulText(reqs.stalls_note)
        || isAffirmative(reqs.telecasting_media)
        || hasMeaningfulText(reqs.telecasting_media_note)
        || hasMeaningfulText(reqs.stage_setup)
        || hasMeaningfulText(reqs.foyer_setup);
    default:
      return false;
  }
}

/** Derive auto-sync checklist value from aggregated requirements. */
export function deriveExecutionSectionStatus(
  fieldKey: ExecutionSectionFieldKey,
  reqs: Record<string, unknown>,
): typeof EXECUTION_SECTION_STATUS.notStarted | typeof EXECUTION_SECTION_STATUS.captured {
  return isExecutionSectionCaptured(fieldKey, reqs)
    ? EXECUTION_SECTION_STATUS.captured
    : EXECUTION_SECTION_STATUS.notStarted;
}

/** Sync must not downgrade ops-confirmed rows. */
export function shouldPreserveExecutionSectionValue(value: string | null | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === EXECUTION_SECTION_STATUS.verified.toLowerCase()
    || v === EXECUTION_SECTION_STATUS.notApplicable.toLowerCase();
}
