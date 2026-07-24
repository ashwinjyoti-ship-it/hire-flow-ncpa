import {
  EVENT_COMPANY_FIELD_KEYS,
  EVENT_COMPANY_REQUIRED_KEY,
  POC_FIELD_KEYS,
  POC_FIELD_LABELS,
  POC_ORGANISATION_LABEL,
  POC_REQUIRED_FIELD_KEYS,
  type EventCompanyFieldKey,
  type PocFieldKey,
  type PocRequiredFieldKey,
} from "./poc-fields";

export const POC_CONFIRMATION_BLOCKER = "POC not filled, cannot confirm.";
export const POC_TASK_RULE = "poc_incomplete";
export const POC_TASK_TITLE = "Complete Point of Contact";

export type PocCompletionStatus = {
  complete: boolean;
  filledCount: number;
  totalCount: number;
  missing: PocFieldKey[];
  missingLabels: string[];
};

function normalisePocValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Whether Event Company contact details are required for this event. */
export function isEventCompanyRequired(
  values: Partial<Record<string, string | null | undefined>>,
): boolean {
  const explicit = normalisePocValue(values[EVENT_COMPANY_REQUIRED_KEY]);
  if (explicit === "yes") return true;
  if (explicit === "n/a" || explicit === "not applicable") return false;
  // Legacy rows: company data present but no toggle → treat as Yes.
  return EVENT_COMPANY_FIELD_KEYS.some((key) => isPocFieldValueFilled(key, values[key]));
}

export function requiredPocFieldKeys(
  values: Partial<Record<string, string | null | undefined>>,
): Array<PocRequiredFieldKey | EventCompanyFieldKey> {
  const keys: Array<PocRequiredFieldKey | EventCompanyFieldKey> = [...POC_REQUIRED_FIELD_KEYS];
  if (isEventCompanyRequired(values)) keys.push(...EVENT_COMPANY_FIELD_KEYS);
  return keys;
}

export function isPocFieldValueFilled(fieldKey: PocFieldKey, value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return false;
  if (fieldKey === "vendor_registration_form") {
    return trimmed !== "Pending";
  }
  return true;
}

export type PocCompletionOptions = {
  /** When provided, Organisation must be set for confirmation readiness. */
  organisationId?: string | null;
};

export function evaluatePocCompletion(
  values: Partial<Record<PocFieldKey, string | null | undefined>>,
  opts?: PocCompletionOptions,
): PocCompletionStatus {
  const requiredKeys = requiredPocFieldKeys(values);
  const missing = requiredKeys.filter((key) => !isPocFieldValueFilled(key, values[key]));
  const organisationMissing = opts ? !(opts.organisationId ?? "").trim() : false;
  const filledCount = (organisationMissing ? 0 : opts ? 1 : 0) + (requiredKeys.length - missing.length);
  const totalCount = requiredKeys.length + (opts ? 1 : 0);
  const missingLabels = [
    ...(organisationMissing ? [POC_ORGANISATION_LABEL] : []),
    ...missing.map((key) => POC_FIELD_LABELS[key]),
  ];
  return {
    complete: missing.length === 0 && !organisationMissing,
    filledCount,
    totalCount,
    missing: missing as PocFieldKey[],
    missingLabels,
  };
}

function parseRequirementsJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function mergePocValues(
  checklistValues: Partial<Record<PocFieldKey, string | null>>,
  requirements: string | null | undefined,
): Partial<Record<PocFieldKey, string | null>> {
  const merged: Partial<Record<PocFieldKey, string | null>> = { ...checklistValues };
  const reqs = parseRequirementsJson(requirements);
  for (const key of POC_FIELD_KEYS) {
    if (isPocFieldValueFilled(key, merged[key])) continue;
    const fromReqs = reqs[key];
    if (typeof fromReqs === "string" && isPocFieldValueFilled(key, fromReqs)) {
      merged[key] = fromReqs.trim();
    }
  }
  return merged;
}

export async function getPocFieldValues(db: D1Database, eventId: string): Promise<Partial<Record<PocFieldKey, string | null>>> {
  const { results: checklistRows } = await db.prepare(
    `SELECT field_key, value FROM checklist_items
     WHERE event_id = ? AND field_key IN (${POC_FIELD_KEYS.map(() => "?").join(", ")})`
  ).bind(eventId, ...POC_FIELD_KEYS).all<{ field_key: string; value: string | null }>();

  const checklistValues: Partial<Record<PocFieldKey, string | null>> = {};
  for (const row of checklistRows ?? []) {
    checklistValues[row.field_key as PocFieldKey] = row.value;
  }

  const event = await db.prepare("SELECT requirements FROM events WHERE id = ?")
    .bind(eventId).first<{ requirements: string | null }>();

  return mergePocValues(checklistValues, event?.requirements);
}

export async function evaluatePocCompletionForEvent(db: D1Database, eventId: string): Promise<PocCompletionStatus> {
  const values = await getPocFieldValues(db, eventId);
  const event = await db.prepare("SELECT organisation_id FROM events WHERE id = ?")
    .bind(eventId).first<{ organisation_id: string | null }>();
  return evaluatePocCompletion(values, { organisationId: event?.organisation_id ?? null });
}

export type PocIncompleteEventRef = {
  event_id: string;
  event_title: string;
  organisation_name: string | null;
  event_start_date: string | null;
  status: string;
  filled_count: number;
  total_count: number;
  missing_labels: string[];
};

const POC_INCOMPLETE_ACTIVE_STATUSES = ["enquiry", "tentative", "approved"] as const;

/** Active pipeline events missing one or more POC fields (for briefs / reports). */
export async function listEventsWithIncompletePoc(
  db: D1Database,
  opts?: { limit?: number },
): Promise<PocIncompleteEventRef[]> {
  const limit = opts?.limit ?? 10;
  const statusPlaceholders = POC_INCOMPLETE_ACTIVE_STATUSES.map(() => "?").join(", ");
  const { results: events } = await db.prepare(
    `SELECT e.id AS event_id, e.title AS event_title, o.name AS organisation_name,
            e.organisation_id, e.event_start_date, e.status
     FROM events e
     LEFT JOIN organisations o ON o.id = e.organisation_id
     WHERE e.is_archived = 0 AND e.status IN (${statusPlaceholders})
     ORDER BY COALESCE(e.event_start_date, '9999'), e.title`,
  ).bind(...POC_INCOMPLETE_ACTIVE_STATUSES).all<{
    event_id: string;
    event_title: string;
    organisation_name: string | null;
    organisation_id: string | null;
    event_start_date: string | null;
    status: string;
  }>();

  const eventIds = (events ?? []).map((e) => e.event_id);
  const pocValuesByEvent = await getPocFieldValuesForEvents(db, eventIds);
  const incomplete: PocIncompleteEventRef[] = [];

  for (const event of events ?? []) {
    const poc = evaluatePocCompletion(pocValuesByEvent.get(event.event_id) ?? {}, {
      organisationId: event.organisation_id,
    });
    if (!poc.complete) {
      incomplete.push({
        ...event,
        filled_count: poc.filledCount,
        total_count: poc.totalCount,
        missing_labels: poc.missingLabels,
      });
    }
  }

  return incomplete.slice(0, limit);
}

export async function getPocFieldValuesForEvents(
  db: D1Database,
  eventIds: string[],
): Promise<Map<string, Partial<Record<PocFieldKey, string | null>>>> {
  const out = new Map<string, Partial<Record<PocFieldKey, string | null>>>();
  if (eventIds.length === 0) return out;

  const checklistByEvent = new Map<string, Partial<Record<PocFieldKey, string | null>>>();
  // D1/SQLite caps bound parameters per statement. Dashboard feeds may pass
  // hundreds of event ids, so keep every enrichment query comfortably below
  // that limit instead of letting the whole lifecycle endpoint fail.
  const batchSize = 75;
  for (let offset = 0; offset < eventIds.length; offset += batchSize) {
    const batch = eventIds.slice(offset, offset + batchSize);
    const placeholders = batch.map(() => "?").join(", ");
    const { results: checklistRows } = await db.prepare(
      `SELECT event_id, field_key, value FROM checklist_items
       WHERE event_id IN (${placeholders})
         AND field_key IN (${POC_FIELD_KEYS.map(() => "?").join(", ")})`
    ).bind(...batch, ...POC_FIELD_KEYS).all<{ event_id: string; field_key: string; value: string | null }>();

    for (const row of checklistRows ?? []) {
      const current = checklistByEvent.get(row.event_id) ?? {};
      current[row.field_key as PocFieldKey] = row.value;
      checklistByEvent.set(row.event_id, current);
    }

    const { results: eventRows } = await db.prepare(
      `SELECT id, requirements FROM events WHERE id IN (${placeholders})`
    ).bind(...batch).all<{ id: string; requirements: string | null }>();

    for (const event of eventRows ?? []) {
      out.set(event.id, mergePocValues(checklistByEvent.get(event.id) ?? {}, event.requirements));
    }
  }
  for (const eventId of eventIds) {
    if (!out.has(eventId)) out.set(eventId, {});
  }
  return out;
}
