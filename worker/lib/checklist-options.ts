import type { D1Database } from "@cloudflare/workers-types";

/** Checklist fields whose dropdown options come from dropdown_options (Settings). */
export const CHECKLIST_LOOKUP_LIST_KEYS: Record<string, string> = {
  genre_head: "approval_sent_to",
};

export type ChecklistOptionsCarrier = {
  field_key: string;
  field_type: string;
  options: string | null;
  value?: string | null;
};

export async function loadLookupOptionValues(
  db: D1Database,
  listKey: string,
  includeValue?: string | null,
): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT value FROM dropdown_options
     WHERE list_key = ? AND is_active = 1
     ORDER BY sort_order, value`
  ).bind(listKey).all<{ value: string }>();

  const values = (results ?? []).map((row) => row.value);
  const extra = includeValue?.trim();
  if (extra && !values.some((value) => value.toLowerCase() === extra.toLowerCase())) {
    return [...values, extra];
  }
  return values;
}

export async function hydrateChecklistItemOptions<T extends ChecklistOptionsCarrier>(
  db: D1Database,
  items: T[],
): Promise<T[]> {
  const listKeys = new Set(
    items
      .map((item) => (
        item.field_type === "dropdown" ? CHECKLIST_LOOKUP_LIST_KEYS[item.field_key] : undefined
      ))
      .filter((key): key is string => Boolean(key)),
  );
  if (!listKeys.size) return items;

  const valuesByListKey = new Map<string, string[]>();
  await Promise.all([...listKeys].map(async (listKey) => {
    valuesByListKey.set(listKey, await loadLookupOptionValues(db, listKey));
  }));

  return items.map((item) => {
    const listKey = CHECKLIST_LOOKUP_LIST_KEYS[item.field_key];
    if (!listKey || item.field_type !== "dropdown") return item;

    let values = [...(valuesByListKey.get(listKey) ?? [])];
    const extra = item.value?.trim();
    if (extra && !values.some((value) => value.toLowerCase() === extra.toLowerCase())) {
      values = [...values, extra];
    }
    return { ...item, options: JSON.stringify(values) };
  });
}
