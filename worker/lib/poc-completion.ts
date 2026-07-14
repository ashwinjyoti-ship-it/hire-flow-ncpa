import { POC_FIELD_KEYS, POC_FIELD_LABELS, type PocFieldKey } from "./poc-fields";

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

export function isPocFieldValueFilled(fieldKey: PocFieldKey, value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return false;
  if (fieldKey === "vendor_registration_form") {
    return trimmed !== "Pending";
  }
  return true;
}

export function evaluatePocCompletion(values: Partial<Record<PocFieldKey, string | null | undefined>>): PocCompletionStatus {
  const missing = POC_FIELD_KEYS.filter((key) => !isPocFieldValueFilled(key, values[key]));
  const filledCount = POC_FIELD_KEYS.length - missing.length;
  return {
    complete: missing.length === 0,
    filledCount,
    totalCount: POC_FIELD_KEYS.length,
    missing,
    missingLabels: missing.map((key) => POC_FIELD_LABELS[key]),
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
  return evaluatePocCompletion(values);
}

export async function getPocFieldValuesForEvents(
  db: D1Database,
  eventIds: string[],
): Promise<Map<string, Partial<Record<PocFieldKey, string | null>>>> {
  const out = new Map<string, Partial<Record<PocFieldKey, string | null>>>();
  if (eventIds.length === 0) return out;

  const placeholders = eventIds.map(() => "?").join(", ");
  const { results: checklistRows } = await db.prepare(
    `SELECT event_id, field_key, value FROM checklist_items
     WHERE event_id IN (${placeholders})
       AND field_key IN (${POC_FIELD_KEYS.map(() => "?").join(", ")})`
  ).bind(...eventIds, ...POC_FIELD_KEYS).all<{ event_id: string; field_key: string; value: string | null }>();

  const checklistByEvent = new Map<string, Partial<Record<PocFieldKey, string | null>>>();
  for (const row of checklistRows ?? []) {
    const current = checklistByEvent.get(row.event_id) ?? {};
    current[row.field_key as PocFieldKey] = row.value;
    checklistByEvent.set(row.event_id, current);
  }

  const { results: eventRows } = await db.prepare(
    `SELECT id, requirements FROM events WHERE id IN (${placeholders})`
  ).bind(...eventIds).all<{ id: string; requirements: string | null }>();

  for (const event of eventRows ?? []) {
    out.set(event.id, mergePocValues(checklistByEvent.get(event.id) ?? {}, event.requirements));
  }
  for (const eventId of eventIds) {
    if (!out.has(eventId)) out.set(eventId, {});
  }
  return out;
}
