import { isChecklistFieldVisible, type ChecklistVisibilityItem } from "./checklist-visibility";
import { POST_EVENT_CHECKLIST_SECTION } from "./lifecycle-workflow-phase";

export const FILE_CLOSE_CANCEL_NOTE = "Cancelled automatically because the file was closed.";

export type FileCloseGateItem = {
  module: string;
  section: string;
  field_key: string;
  label: string;
  status: string;
  value: string | null;
  is_computed?: number;
  visibility_rule?: string | null;
};

/** Incomplete post-event + accounts checklist fields that block file close. */
export function blockersForFileClose(items: FileCloseGateItem[]): string[] {
  const visibilityByKey = new Map<string, ChecklistVisibilityItem>(
    items.map((item) => [item.field_key, {
      field_key: item.field_key,
      value: item.value,
      visibility_rule: item.visibility_rule ?? null,
    }]),
  );

  const blockers: string[] = [];
  for (const item of items) {
    if (item.field_key === "file_closed") continue;
    if (item.is_computed) continue;
    if (item.module !== "accounts" && item.section !== POST_EVENT_CHECKLIST_SECTION) continue;
    if (!isChecklistFieldVisible(item, visibilityByKey)) continue;
    if (item.status === "completed" || item.status === "not_applicable") continue;
    blockers.push(`${item.section}: ${item.label}`);
  }
  return blockers;
}

export function formatFileCloseBlockedMessage(blockers: string[]): string {
  if (!blockers.length) return "";
  return `Cannot close file until the following are completed: ${blockers.join("; ")}`;
}
