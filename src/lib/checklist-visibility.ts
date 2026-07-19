export {
  isChecklistFieldVisible,
  type ChecklistVisibilityItem,
} from "../../worker/lib/checklist-visibility";

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
