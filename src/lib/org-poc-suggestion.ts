import { POC_FIELD_KEYS } from "../../worker/lib/poc-fields";

export type PocSuggestionSource =
  | {
    type: "event";
    event_id: string;
    event_title: string;
    event_start_date: string | null;
  }
  | {
    type: "organisation";
  };

export type PocSuggestionResponse = {
  suggestion: Partial<Record<string, string | null>>;
  source: PocSuggestionSource | null;
  preview: {
    poc_name: string | null;
    poc_email: string | null;
  };
};

export const SENSITIVE_POC_FIELD_KEYS = ["bank_details", "signing_authority_address"] as const;

export function isPocFieldEmpty(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function hasAnyPocSuggestionValues(
  suggestion: Partial<Record<string, string | null>> | null | undefined,
): boolean {
  if (!suggestion) return false;
  return POC_FIELD_KEYS.some((key) => !isPocFieldEmpty(suggestion[key]));
}

/** Count suggestion fields that would fill currently empty POC inputs. */
export function countApplicablePocSuggestionFields(
  current: Record<string, unknown>,
  suggestion: Partial<Record<string, string | null>>,
): number {
  let count = 0;
  for (const key of POC_FIELD_KEYS) {
    if (isPocFieldEmpty(current[key]) && !isPocFieldEmpty(suggestion[key])) count += 1;
  }
  return count;
}

/** Apply a POC suggestion without overwriting user-entered values. */
export function applyPocSuggestion(
  current: Record<string, unknown>,
  suggestion: Partial<Record<string, string | null>>,
): Record<string, unknown> {
  const next = { ...current };
  for (const key of POC_FIELD_KEYS) {
    const suggested = suggestion[key];
    if (isPocFieldEmpty(suggested)) continue;
    if (!isPocFieldEmpty(next[key])) continue;
    next[key] = suggested;
  }
  return next;
}

export function formatPocSuggestionSourceLabel(
  source: PocSuggestionSource | null,
  organisationName: string,
): string {
  if (!source) return organisationName;
  if (source.type === "organisation") {
    return `${organisationName} (organisation directory)`;
  }
  const date = source.event_start_date?.trim();
  const dateSuffix = date ? `, ${date}` : "";
  return `${organisationName} (from event “${source.event_title}”${dateSuffix})`;
}
