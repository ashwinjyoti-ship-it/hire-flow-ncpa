/** Shared checklist field visibility (mirrors visibility_rule on definitions). */

export type ChecklistVisibilityItem = {
  field_key: string;
  value: string | null;
  visibility_rule?: string | null;
};

/**
 * Resolves a field's conditional visibility. Rules use the grammar
 * `onlyWhen(<fieldKey> == <value>)`; a field with no visibility_rule is always
 * visible. Controllers that are themselves hidden also hide their dependents.
 */
export function isChecklistFieldVisible(
  item: ChecklistVisibilityItem,
  itemByKey: Map<string, ChecklistVisibilityItem>,
  seen = new Set<string>(),
): boolean {
  const rule = item.visibility_rule?.trim();
  if (!rule) return true;
  const match = rule.match(/^onlyWhen\(\s*([a-zA-Z0-9_]+)\s*==\s*(.+?)\s*\)$/i);
  if (!match || match.length < 3) return true;
  const controllerKey = match[1]!;
  if (seen.has(controllerKey)) return true;
  seen.add(controllerKey);
  const expected = (match[2] ?? "").trim();
  const controller = itemByKey.get(controllerKey);
  const actual = (controller?.value ?? "").trim();
  if (actual.toLowerCase() !== expected.toLowerCase()) return false;
  if (controller && !isChecklistFieldVisible(controller, itemByKey, seen)) return false;
  return true;
}

/** Gate / controller fields read better full-width above their dependents. */
export function isFullWidthChecklistField(fieldKey: string): boolean {
  return fieldKey === "onstage_required"
    || fieldKey === "emailer"
    || fieldKey === "approval_required"
    || fieldKey === "instalment"
    || fieldKey === "noc_sent"
    || fieldKey === "tds_certificate_from_client"
    || fieldKey === "monthly_chart_sent";
}
