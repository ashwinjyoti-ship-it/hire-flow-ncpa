import {
  CATERING_MEAL_TYPES,
  cateringMealPaxKey,
  cateringMealRequiredKey,
} from "./catering-meals";

export type ReadinessState = "missing" | "partial" | "almost" | "complete" | "not_applicable";

export type ReadinessSection = {
  key: string;
  label: string;
  state: ReadinessState;
  filled: number;
  total: number;
  percentage: number;
  missingKeys: string[];
  missingLabels: string[];
  formSection: string;
};

export type EventFormReadiness = {
  percentage: number;
  completedSections: number;
  applicableSections: number;
  missingCount: number;
  sections: ReadinessSection[];
};

type RequirementValues = Record<string, unknown>;
type FieldRequirement = { key: string; label: string; active?: (values: RequirementValues) => boolean };
type SectionDefinition = {
  key: string;
  label: string;
  formSection: string;
  fields: (values: RequirementValues) => FieldRequirement[];
  notApplicable?: (values: RequirementValues) => boolean;
};

const text = (value: unknown): string => String(value ?? "").trim();
const lower = (value: unknown): string => text(value).toLowerCase();
const filled = (value: unknown): boolean => text(value).length > 0;
const isYes = (value: unknown): boolean => ["yes", "required", "keep"].includes(lower(value));
const isNo = (value: unknown): boolean => ["no", "not required", "remove"].includes(lower(value));

const decision = (key: string, label: string): FieldRequirement => ({ key, label });
const detail = (key: string, label: string, when: (values: RequirementValues) => boolean): FieldRequirement => ({ key, label, active: when });

const SECTIONS: SectionDefinition[] = [
  {
    key: "technical_sound",
    label: "Technical / sound",
    formSection: "technical_sound",
    fields: () => [
      decision("sound", "Sound requirements"),
      decision("sound_call_time", "Sound call time"),
      decision("light", "Light requirements"),
      decision("light_call_time", "Light call time"),
    ],
  },
  {
    key: "staffing_facilities",
    label: "Staffing / facilities",
    formSection: "staffing_facilities",
    fields: (values) => [
      decision("green_rooms_required", "Green rooms decision"),
      detail("green_room_amenities", "Green room amenities", (v) => isYes(v.green_rooms_required)),
      decision("ushers_required", "Ushers decision"),
      detail("ushers_call_time", "Ushers call time", (v) => isYes(v.ushers_required)),
      decision("loaders_required", "Loaders decision"),
      detail("loaders_call_time", "Loaders call time", (v) => isYes(v.loaders_required)),
      decision("house_seats_release", "House seats decision"),
      detail("house_tickets", "House ticket type", (v) => isYes(v.house_seats_release)),
    ].filter((field) => field.active?.(values) ?? true),
    notApplicable: (values) => [
      values.green_rooms_required,
      values.ushers_required,
      values.loaders_required,
      values.house_seats_release,
    ].every(isNo),
  },
  {
    key: "recording_special",
    label: "Recording / special",
    formSection: "recording_special",
    fields: (values) => [
      decision("video_recording", "Video recording decision"),
      detail("camera_count", "Camera count", (v) => isYes(v.video_recording)),
      detail("recording_type", "Recording type", (v) => isYes(v.video_recording)),
      decision("piano_required", "Piano decision"),
      detail("piano_tuning_time", "Piano tuning time", (v) => isYes(v.piano_required)),
      decision("liquor_licence", "Liquor licence decision"),
      detail("liquor_licence_details", "Liquor licence details", (v) => isYes(v.liquor_licence)),
    ].filter((field) => field.active?.(values) ?? true),
    notApplicable: (values) => [values.video_recording, values.piano_required, values.liquor_licence].every(isNo),
  },
  {
    key: "catering",
    label: "Catering",
    formSection: "catering",
    fields: (values) => {
      const fields: FieldRequirement[] = [decision("catering_required", "Catering decision")];
      if (!isYes(values.catering_required)) return fields;
      fields.push(decision("catering_provider", "Caterer"), decision("interval", "Interval decision"));
      for (const meal of CATERING_MEAL_TYPES) {
        const requiredKey = cateringMealRequiredKey(meal.key);
        fields.push(decision(requiredKey, `${meal.label} decision`));
        if (isYes(values[requiredKey])) fields.push(decision(cateringMealPaxKey(meal.key), `${meal.label} pax`));
      }
      return fields;
    },
    notApplicable: (values) => isNo(values.catering_required),
  },
  {
    key: "decorator",
    label: "Decorator",
    formSection: "decorator",
    fields: (values) => [
      decision("decorator_required", "Decorator decision"),
      detail("decorator_name", "Decorator name", (v) => isYes(v.decorator_required)),
    ].filter((field) => field.active?.(values) ?? true),
    notApplicable: (values) => isNo(values.decorator_required),
  },
  {
    key: "operations",
    label: "Operations / licences",
    formSection: "operations",
    fields: (values) => [
      decision("parking", "Parking requirements"),
      decision("security", "Security notes"),
      decision("housekeeping", "Housekeeping"),
      decision("crew_cards", "Crew cards"),
      decision("licenses_status", "Licences decision"),
      detail("licenses", "Licence types", (v) => ["required", "awaiting", "received"].includes(lower(v.licenses_status))),
    ].filter((field) => field.active?.(values) ?? true),
  },
  {
    key: "additional",
    label: "Additional requirements",
    formSection: "additional",
    fields: (values) => [
      decision("orchestra_pit_chairs", "Orchestra pit chairs decision"),
      decision("digital_standee", "Digital standee decision"),
      detail("digital_standee_note", "Digital standee details", (v) => isYes(v.digital_standee)),
      decision("car_display", "Car display decision"),
      detail("car_display_note", "Car display details", (v) => isYes(v.car_display)),
      decision("bike_display", "Bike display decision"),
      detail("bike_display_note", "Bike display details", (v) => isYes(v.bike_display)),
      decision("stalls", "Stalls decision"),
      detail("stalls_note", "Stalls details", (v) => isYes(v.stalls)),
      decision("telecasting_media", "Telecasting / media decision"),
      detail("telecasting_media_note", "Telecasting / media details", (v) => isYes(v.telecasting_media)),
      decision("stage_setup", "Stage setup"),
      decision("foyer_setup", "Foyer setup"),
    ].filter((field) => field.active?.(values) ?? true),
  },
];

export function parseRequirementValues(raw: unknown): RequirementValues {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as RequirementValues;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RequirementValues : {};
  } catch {
    return {};
  }
}

export function calculateEventFormReadiness(raw: unknown): EventFormReadiness {
  const values = parseRequirementValues(raw);
  const sections = SECTIONS.map((definition): ReadinessSection => {
    const fields = definition.fields(values);
    const missing = fields.filter((field) => !filled(values[field.key]));
    const isNotApplicable = Boolean(definition.notApplicable?.(values)) && missing.length === 0;
    const total = fields.length;
    const filledCount = total - missing.length;
    const percentage = total ? Math.round((filledCount / total) * 100) : 100;
    const state: ReadinessState = isNotApplicable
      ? "not_applicable"
      : percentage === 100
        ? "complete"
        : percentage === 0
          ? "missing"
          : percentage >= 70
            ? "almost"
            : "partial";
    return {
      key: definition.key,
      label: definition.label,
      state,
      filled: filledCount,
      total,
      percentage,
      missingKeys: missing.map((field) => field.key),
      missingLabels: missing.map((field) => field.label),
      formSection: definition.formSection,
    };
  });
  const applicable = sections.filter((section) => section.state !== "not_applicable");
  const totalFields = applicable.reduce((sum, section) => sum + section.total, 0);
  const filledFields = applicable.reduce((sum, section) => sum + section.filled, 0);
  return {
    percentage: totalFields ? Math.round((filledFields / totalFields) * 100) : 100,
    completedSections: sections.filter((section) => section.state === "complete" || section.state === "not_applicable").length,
    applicableSections: applicable.length,
    missingCount: applicable.reduce((sum, section) => sum + section.missingKeys.length, 0),
    sections,
  };
}

export function readinessTaskRule(sectionKey: string): string {
  return `event_form_readiness:${sectionKey}`;
}

export function readinessSectionKeyFromRule(rule: string | null | undefined): string | null {
  const prefix = "event_form_readiness:";
  return rule?.startsWith(prefix) ? rule.slice(prefix.length) || null : null;
}
