import { POC_FIELD_KEYS, type PocFieldKey } from "./poc-fields";

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

export type OrgPocSuggestion = {
  suggestion: Partial<Record<PocFieldKey, string | null>>;
  source: PocSuggestionSource | null;
  preview: {
    poc_name: string | null;
    poc_email: string | null;
  };
};

type RequirementsRecord = Record<string, unknown>;

function parseRequirementsJson(raw: string | null | undefined): RequirementsRecord {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as RequirementsRecord)
      : {};
  } catch {
    return {};
  }
}

function isFilledPocValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickPocFieldsFromRequirements(requirements: RequirementsRecord): Partial<Record<PocFieldKey, string | null>> {
  const out: Partial<Record<PocFieldKey, string | null>> = {};
  for (const key of POC_FIELD_KEYS) {
    const value = requirements[key];
    if (isFilledPocValue(value)) out[key] = value.trim();
  }
  return out;
}

function hasAnyPocValues(values: Partial<Record<PocFieldKey, string | null>>): boolean {
  return POC_FIELD_KEYS.some((key) => isFilledPocValue(values[key]));
}

function formatOrgBankDetails(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string") {
      const trimmed = parsed.trim();
      return trimmed || null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const lines = ["bank", "account_name", "account_no", "ifsc", "branch"]
        .map((key) => {
          const value = record[key];
          if (value == null || String(value).trim() === "") return null;
          return `${key.replace(/_/g, " ")}: ${String(value).trim()}`;
        })
        .filter(Boolean);
      if (lines.length > 0) return lines.join("\n");
    }
  } catch {
    const trimmed = raw.trim();
    return trimmed || null;
  }
  return null;
}

function mergeSuggestionFields(
  base: Partial<Record<PocFieldKey, string | null>>,
  next: Partial<Record<PocFieldKey, string | null>>,
): Partial<Record<PocFieldKey, string | null>> {
  const merged = { ...base };
  for (const key of POC_FIELD_KEYS) {
    if (isFilledPocValue(merged[key])) continue;
    const value = next[key];
    if (isFilledPocValue(value)) merged[key] = value.trim();
  }
  return merged;
}

function suggestionFromOrganisationRecord(
  org: Record<string, unknown>,
  primaryContact: Record<string, unknown> | null,
): Partial<Record<PocFieldKey, string | null>> {
  const suggestion: Partial<Record<PocFieldKey, string | null>> = {};
  if (primaryContact) {
    if (isFilledPocValue(primaryContact.name)) suggestion.poc_name = primaryContact.name.trim();
    if (isFilledPocValue(primaryContact.phone)) suggestion.poc_contact_number = primaryContact.phone.trim();
    if (isFilledPocValue(primaryContact.email)) suggestion.poc_email = primaryContact.email.trim();
    if (isFilledPocValue(primaryContact.courier_address)) {
      suggestion.courier_address = primaryContact.courier_address.trim();
    }
  }
  if (isFilledPocValue(org.gst_number)) suggestion.gst_no = org.gst_number.trim();
  if (isFilledPocValue(org.pan_number)) suggestion.pan_no = org.pan_number.trim();
  if (isFilledPocValue(org.tan_number)) suggestion.tan_no = org.tan_number.trim();
  const bankDetails = formatOrgBankDetails(org.bank_details as string | null | undefined);
  if (bankDetails) suggestion.bank_details = bankDetails;
  return suggestion;
}

function buildPreview(suggestion: Partial<Record<PocFieldKey, string | null>>): OrgPocSuggestion["preview"] {
  return {
    poc_name: suggestion.poc_name ?? null,
    poc_email: suggestion.poc_email ?? null,
  };
}

/** Latest event POC for an organisation, with directory fallbacks for missing fields. */
export async function getOrgPocSuggestion(db: D1Database, organisationId: string): Promise<OrgPocSuggestion> {
  const org = await db.prepare(
    "SELECT id, name, gst_number, pan_number, tan_number, bank_details FROM organisations WHERE id = ? AND is_archived = 0",
  ).bind(organisationId).first<Record<string, unknown>>();
  if (!org) {
    return { suggestion: {}, source: null, preview: { poc_name: null, poc_email: null } };
  }

  const { results: eventRows } = await db.prepare(
    `SELECT e.id, e.title, e.event_start_date, e.requirements
     FROM events e
     JOIN organisations o ON o.id = e.organisation_id
     WHERE e.is_archived = 0
       AND LOWER(TRIM(o.name)) = (
         SELECT LOWER(TRIM(name)) FROM organisations WHERE id = ?
       )
     ORDER BY
       CASE
         WHEN e.event_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN e.event_start_date
         ELSE '0000-01-01'
       END DESC,
       e.updated_at DESC
     LIMIT 25`,
  ).bind(organisationId).all<{
    id: string;
    title: string;
    event_start_date: string | null;
    requirements: string | null;
  }>();

  let suggestion: Partial<Record<PocFieldKey, string | null>> = {};
  let source: PocSuggestionSource | null = null;

  for (const event of eventRows ?? []) {
    const poc = pickPocFieldsFromRequirements(parseRequirementsJson(event.requirements));
    if (!hasAnyPocValues(poc)) continue;
    suggestion = poc;
    source = {
      type: "event",
      event_id: event.id,
      event_title: event.title,
      event_start_date: event.event_start_date,
    };
    break;
  }

  const primaryContact = await db.prepare(
    `SELECT name, email, phone, courier_address
     FROM contacts
     WHERE organisation_id = ?
     ORDER BY is_primary DESC, name
     LIMIT 1`,
  ).bind(organisationId).first<Record<string, unknown>>();

  const orgFallback = suggestionFromOrganisationRecord(org, primaryContact ?? null);
  if (!hasAnyPocValues(suggestion) && hasAnyPocValues(orgFallback)) {
    suggestion = orgFallback;
    source = { type: "organisation" };
  } else if (hasAnyPocValues(orgFallback)) {
    suggestion = mergeSuggestionFields(suggestion, orgFallback);
  }

  if (!hasAnyPocValues(suggestion)) {
    return { suggestion: {}, source: null, preview: { poc_name: null, poc_email: null } };
  }

  return {
    suggestion,
    source,
    preview: buildPreview(suggestion),
  };
}
