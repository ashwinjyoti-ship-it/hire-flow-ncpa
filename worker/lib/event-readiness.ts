import {
  CATERING_MEAL_TYPES,
  cateringMealPaxKey,
  cateringMealRequiredKey,
  isCateringMealRequired,
} from "./catering-meals";
import {
  optionalDetailFilled,
  optionalGroupDetailsFilled,
  optionalGroupNotApplicable,
} from "./optional-requirements";

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

type FieldRequirement = {
  key: string;
  label: string;
  active?: (values: RequirementValues) => boolean;
  filled?: (values: RequirementValues) => boolean;
};

type SectionDefinition = {
  key: string;
  label: string;
  formSection: string;
  fields: (values: RequirementValues) => FieldRequirement[];
  /** Validated only when they fail — not counted when satisfied (N/A or complete). */
  gaps?: (values: RequirementValues) => FieldRequirement[];
  notApplicable?: (values: RequirementValues) => boolean;
};

const ROLLUP = {
  cateringMeals: "catering_meals",
  staffingOptions: "staffing_facilities_options",
  recordingOptions: "recording_special_options",
  additionalOptions: "additional_options",
} as const;

const STAFFING_TOGGLES = [
  "green_rooms_required",
  "ushers_required",
  "loaders_required",
  "house_seats_release",
] as const;

const RECORDING_TOGGLES = ["video_recording", "piano_required", "liquor_licence"] as const;

const text = (value: unknown): string => String(value ?? "").trim();
const lower = (value: unknown): string => text(value).toLowerCase();
const filled = (value: unknown): boolean => text(value).length > 0;
const isYes = (value: unknown): boolean => ["yes", "required", "keep"].includes(lower(value));
const isNo = (value: unknown): boolean => ["no", "not required", "remove"].includes(lower(value));

const decision = (key: string, label: string): FieldRequirement => ({ key, label });
const rollup = (key: string, label: string, filledFn: (values: RequirementValues) => boolean): FieldRequirement => ({
  key,
  label,
  filled: filledFn,
});

function isFieldMissing(field: FieldRequirement, values: RequirementValues): boolean {
  if (field.active && !field.active(values)) return false;
  if (field.filled) return !field.filled(values);
  return !filled(values[field.key]);
}

function cateringMealsFilled(values: RequirementValues): boolean {
  for (const meal of CATERING_MEAL_TYPES) {
    const requiredKey = cateringMealRequiredKey(meal.key);
    if (!isCateringMealRequired(values[requiredKey])) continue;
    if (!optionalDetailFilled(values[cateringMealPaxKey(meal.key)])) return false;
  }
  return true;
}

function staffingOptionsFilled(values: RequirementValues): boolean {
  return optionalGroupDetailsFilled(values, [
    { toggle: "green_rooms_required", details: ["green_room_amenities"] },
    { toggle: "ushers_required", details: ["ushers_call_time"] },
    { toggle: "loaders_required", details: ["loaders_call_time"] },
    { toggle: "house_seats_release", details: ["house_tickets"] },
  ]);
}

function recordingOptionsFilled(values: RequirementValues): boolean {
  return optionalGroupDetailsFilled(values, [
    { toggle: "video_recording", details: ["camera_count", "recording_type"] },
    { toggle: "piano_required", details: ["piano_tuning_time"] },
    { toggle: "liquor_licence", details: ["liquor_licence_details"] },
  ]);
}

function additionalOptionsFilled(values: RequirementValues): boolean {
  return optionalGroupDetailsFilled(values, [
    { toggle: "digital_standee", details: ["digital_standee_note"] },
    { toggle: "car_display", details: ["car_display_note"] },
    { toggle: "bike_display", details: ["bike_display_note"] },
    { toggle: "stalls", details: ["stalls_note"] },
    { toggle: "telecasting_media", details: ["telecasting_media_note"] },
  ]);
}

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
    fields: () => [],
    gaps: (values) => {
      if (optionalGroupNotApplicable(values, [...STAFFING_TOGGLES])) return [];
      return [rollup(ROLLUP.staffingOptions, "Are staffing options filled?", staffingOptionsFilled)];
    },
    notApplicable: (values) => optionalGroupNotApplicable(values, [...STAFFING_TOGGLES]),
  },
  {
    key: "recording_special",
    label: "Recording / special",
    formSection: "recording_special",
    fields: () => [],
    gaps: (values) => {
      if (optionalGroupNotApplicable(values, [...RECORDING_TOGGLES])) return [];
      return [rollup(ROLLUP.recordingOptions, "Are recording options filled?", recordingOptionsFilled)];
    },
    notApplicable: (values) => optionalGroupNotApplicable(values, [...RECORDING_TOGGLES]),
  },
  {
    key: "catering",
    label: "Catering",
    formSection: "catering",
    fields: (values) => {
      const fields: FieldRequirement[] = [decision("catering_required", "Catering decision")];
      if (!isYes(values.catering_required)) return fields;
      fields.push(decision("catering_provider", "Caterer"), decision("interval", "Interval decision"));
      return fields;
    },
    gaps: (values) => {
      if (!isYes(values.catering_required)) return [];
      if (cateringMealsFilled(values)) return [];
      return [rollup(ROLLUP.cateringMeals, "Are meals filled?", cateringMealsFilled)];
    },
    notApplicable: (values) => isNo(values.catering_required),
  },
  {
    key: "decorator",
    label: "Decorator",
    formSection: "decorator",
    fields: (values) => [
      decision("decorator_required", "Decorator decision"),
      {
        key: "decorator_name",
        label: "Decorator name",
        active: (v: RequirementValues) => isYes(v.decorator_required),
      },
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
      {
        key: "licenses",
        label: "Licence types",
        active: (v: RequirementValues) => ["required", "awaiting", "received"].includes(lower(v.licenses_status)),
      },
    ].filter((field) => field.active?.(values) ?? true),
  },
  {
    key: "additional",
    label: "Additional requirements",
    formSection: "additional",
    fields: () => [
      decision("stage_setup", "Stage setup"),
      decision("foyer_setup", "Foyer setup"),
    ],
    gaps: (values) => {
      if (additionalOptionsFilled(values)) return [];
      return [rollup(ROLLUP.additionalOptions, "Are optional add-ons filled?", additionalOptionsFilled)];
    },
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
    const baseFields = definition.fields(values);
    const gapFields = definition.gaps?.(values) ?? [];
    const baseMissing = baseFields.filter((field) => isFieldMissing(field, values));
    const gapMissing = gapFields.filter((field) => isFieldMissing(field, values));
    const missing = [...baseMissing, ...gapMissing];
    const isNotApplicable = Boolean(definition.notApplicable?.(values)) && missing.length === 0;
    const total = baseFields.length;
    const filledCount = total - baseMissing.length;
    const percentage = total ? Math.round((filledCount / total) * 100) : (missing.length === 0 ? 100 : 0);
    const state: ReadinessState = isNotApplicable
      ? "not_applicable"
      : missing.length === 0
        ? "complete"
        : missing.length > 0 && total === 0
          ? "partial"
          : total === 0
            ? "missing"
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

/** Lifecycle task copy — gap labels (e.g. "Are meals filled?") only appear when something is actually missing. */
export function readinessTaskCopy(section: ReadinessSection): { title: string; description: string } {
  if (section.missingLabels.length === 0) {
    return {
      title: `Complete event form: ${section.label}`,
      description: `${section.filled} of ${section.total} details filled.`,
    };
  }
  const shortMissing = section.missingLabels.slice(0, 2).join(", ");
  const remaining = section.missingLabels.length - 2;
  return {
    title: `Complete event form: ${section.label} — ${shortMissing}${remaining > 0 ? ` +${remaining} more` : ""}`,
    description: `${section.filled} of ${section.total} details filled. Still needed: ${section.missingLabels.join(", ")}.`,
  };
}

export function readinessTaskRule(sectionKey: string): string {
  return `event_form_readiness:${sectionKey}`;
}

export function readinessSectionKeyFromRule(rule: string | null | undefined): string | null {
  const prefix = "event_form_readiness:";
  return rule?.startsWith(prefix) ? rule.slice(prefix.length) || null : null;
}
