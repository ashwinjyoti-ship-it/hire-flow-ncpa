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

/** Ping-pong rounds after the initial send. Close requires any one received-edit date, not the unused later trips. */
const FILE_TRACKING_OPTIONAL_ROUND_KEYS = new Set([
  "file_received_back_edit_1",
  "file_sent_back_after_edit_1",
  "file_received_back_edit_2",
  "file_sent_back_after_edit_2",
]);

const FILE_TRACKING_RECEIVED_EDIT_KEYS = new Set([
  "file_received_back_edit_1",
  "file_received_back_edit_2",
]);

function isFilledDate(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

/** Incomplete post-event + accounts checklist fields that block file close. */
export function blockersForFileClose(items: FileCloseGateItem[]): string[] {
  const visibilityByKey = new Map<string, ChecklistVisibilityItem>(
    items.map((item) => [item.field_key, {
      field_key: item.field_key,
      value: item.value,
      visibility_rule: item.visibility_rule ?? null,
    }]),
  );

  const hasReceivedEdit = items.some(
    (item) => FILE_TRACKING_RECEIVED_EDIT_KEYS.has(item.field_key) && isFilledDate(item.value),
  );
  const hasEditTracking = items.some((item) => FILE_TRACKING_RECEIVED_EDIT_KEYS.has(item.field_key));

  const blockers: string[] = [];
  for (const item of items) {
    if (item.field_key === "file_closed") continue;
    if (item.is_computed) continue;
    if (item.module !== "accounts" && item.section !== POST_EVENT_CHECKLIST_SECTION) continue;
    if (!isChecklistFieldVisible(item, visibilityByKey)) continue;
    if (FILE_TRACKING_OPTIONAL_ROUND_KEYS.has(item.field_key)) continue;
    if (item.status === "completed" || item.status === "not_applicable") continue;
    blockers.push(`${item.section}: ${item.label}`);
  }
  if (hasEditTracking && !hasReceivedEdit) {
    blockers.push("File Tracking: File Received Back — Edit 1 or Edit 2 — Date");
  }
  return blockers;
}

export function formatFileCloseBlockedMessage(blockers: string[]): string {
  if (!blockers.length) return "";
  return `Cannot close file until the following are completed: ${blockers.join("; ")}`;
}
