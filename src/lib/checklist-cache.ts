/** Client-side checklist cache helpers for instant visibility toggles. */

export type ChecklistCacheItem = {
  id: string;
  module: "operations" | "accounts";
  section: string;
  field_key: string;
  label: string;
  status: string;
  value: string | null;
  due_date: string | null;
  field_type: string;
  options: string[] | null;
  is_computed: number;
  visibility_rule?: string | null;
};

export type ChecklistCacheResponse = {
  checklist: Record<"operations" | "accounts", Record<string, ChecklistCacheItem[]>>;
  lifecycle: {
    current: string;
    canConfirm: boolean;
    blockers: string[];
    nextAction: unknown;
    actions: unknown[];
  };
  poc: unknown;
};

const ONSTAGE_PIPELINE_KEYS = new Set([
  "onstage_asked_client",
  "onstage_received_from_client",
  "onstage_sent_to_team",
  "onstage_verified",
  "onstage_complete",
]);

const EMAILER_DATE_KEYS = new Set([
  "emailer_asked_client",
  "emailer_received_from_client",
  "emailer_sent_to_team",
  "emailer_sent",
]);

const APPROVAL_DEPENDENT_KEYS = new Set([
  "approval_sent_on",
  "approval_received_on",
  "genre_head",
]);

const INSTALMENT_DATE_KEYS = new Set([
  "installment_1_expected_date",
  "installment_2_expected_date",
  "installment_3_expected_date",
  "installment_4_expected_date",
  "installment_5_expected_date",
]);

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Rough mirror of server itemStatusForValue for dropdown gates (UI badges only). */
export function optimisticDropdownStatus(value: string | null): string {
  const v = normalise(value);
  if (!v) return "not_started";
  if (["not required", "n/a", "n.a.", "not applicable", "no applicable"].includes(v)) return "not_applicable";
  if (["yes", "sent", "approved", "received", "completed", "ready", "verified"].includes(v)) return "completed";
  if (["no", "not sent", "incomplete", "not started", "awaiting", "pending"].includes(v)) return "not_started";
  return "in_progress";
}

function forEachChecklistItem(
  data: ChecklistCacheResponse,
  fn: (item: ChecklistCacheItem) => void,
): void {
  for (const module of ["operations", "accounts"] as const) {
    for (const items of Object.values(data.checklist[module] ?? {})) {
      for (const item of items) fn(item);
    }
  }
}

function setDependentStatuses(keys: Set<string>, status: string, data: ChecklistCacheResponse): void {
  forEachChecklistItem(data, (item) => {
    if (keys.has(item.field_key)) item.status = status;
  });
}

/** Apply optimistic value + visibility side-effects before the server round-trip. */
export function applyOptimisticChecklistUpdate(
  data: ChecklistCacheResponse,
  item: Pick<ChecklistCacheItem, "id" | "field_key" | "field_type">,
  value: string | null,
  status?: string,
): ChecklistCacheResponse {
  const next: ChecklistCacheResponse = structuredClone(data);
  let updated = false;

  forEachChecklistItem(next, (row) => {
    if (row.id !== item.id) return;
    row.value = value;
    row.status = status ?? (item.field_type === "dropdown" || item.field_type === "status"
      ? optimisticDropdownStatus(value)
      : value ? "completed" : "not_started");
    updated = true;
  });
  if (!updated) return data;

  const v = normalise(value);
  if (item.field_key === "onstage_required") {
    setDependentStatuses(
      ONSTAGE_PIPELINE_KEYS,
      v === "not required" ? "not_applicable" : "not_started",
      next,
    );
  }
  if (item.field_key === "emailer") {
    setDependentStatuses(
      EMAILER_DATE_KEYS,
      v === "yes" ? "not_started" : "not_applicable",
      next,
    );
  }
  if (item.field_key === "approval_required") {
    setDependentStatuses(
      APPROVAL_DEPENDENT_KEYS,
      v === "not required" ? "not_applicable" : "not_started",
      next,
    );
  }
  if (item.field_key === "instalment") {
    setDependentStatuses(
      INSTALMENT_DATE_KEYS,
      v === "yes" ? "not_started" : "not_applicable",
      next,
    );
  }
  if (item.field_key === "noc_sent") {
    forEachChecklistItem(next, (row) => {
      if (row.field_key === "noc_sent_on") {
        row.status = v === "sent" ? "not_started" : "not_applicable";
      }
    });
  }

  return next;
}

export function mergeChecklistItem(
  data: ChecklistCacheResponse,
  item: ChecklistCacheItem,
): ChecklistCacheResponse {
  const next: ChecklistCacheResponse = structuredClone(data);
  forEachChecklistItem(next, (row) => {
    if (row.id === item.id) Object.assign(row, item);
  });
  return next;
}
