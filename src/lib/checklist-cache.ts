/** Client-side checklist cache helpers for instant visibility toggles. */

import {
  APPROVAL_DEPENDENT_FIELD_KEYS,
  buildLifecycleReadiness,
  EMAILER_DEPENDENT_FIELD_KEYS,
  NOC_DEPENDENT_FIELD_KEYS,
  ONSTAGE_DEPENDENT_FIELD_KEYS,
  TDS_DEPENDENT_FIELD_KEYS,
  type EventLifecycleRow,
} from "../../worker/lib/operations";
import type { EventStatus } from "../../worker/lib/state-machine";

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

/** Event fields mirrored from checklist updates for instant header / lifecycle UI. */
export type OptimisticEventSnapshot = {
  status: EventStatus;
  event_type: string | null;
  approval_status: string | null;
  confirmation_status: string | null;
  poc_complete?: boolean;
  payment_status?: string | null;
};

const INSTALMENT_DATE_KEYS = new Set([
  "installment_1_expected_date",
  "installment_2_expected_date",
  "installment_3_expected_date",
  "installment_4_expected_date",
  "installment_5_expected_date",
]);

/** Controllers that trigger optimistic dependent-status updates (audit: keep in sync with seed visibility_rule). */
export const OPTIMISTIC_GATE_CONTROLLERS = [
  "onstage_required",
  "emailer",
  "approval_required",
  "instalment",
  "noc_sent",
  "tds_certificate_from_client",
] as const;

export type OptimisticGateController = (typeof OPTIMISTIC_GATE_CONTROLLERS)[number];

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Rough mirror of server itemStatusForValue for optimistic UI badges. */
export function optimisticFieldStatus(
  fieldType: string,
  value: string | null,
  status?: string,
): string {
  if (status) return status;
  if (fieldType === "dropdown" || fieldType === "status") return optimisticDropdownStatus(value);
  if (fieldType === "date" && value) return value <= todayIso() ? "completed" : "in_progress";
  return value ? "completed" : "not_started";
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

export function checklistValueByKey(
  data: ChecklistCacheResponse,
  fieldKey: string,
): string | null | undefined {
  for (const module of ["operations", "accounts"] as const) {
    for (const items of Object.values(data.checklist[module] ?? {})) {
      const found = items.find((item) => item.field_key === fieldKey);
      if (found) return found.value;
    }
  }
  return undefined;
}

export function eventSnapshotFromDetail(event: Record<string, unknown>): OptimisticEventSnapshot {
  return {
    status: event.status as EventStatus,
    event_type: (event.event_type as string | null) ?? null,
    approval_status: (event.approval_status as string | null) ?? null,
    confirmation_status: (event.confirmation_status as string | null) ?? null,
    poc_complete: (event.poc_completion as { complete?: boolean } | undefined)?.complete
      ?? (event.poc_complete as boolean | undefined),
    payment_status: (event.payment_status as string | null) ?? null,
  };
}

function deriveOptimisticConfirmationStatus(
  current: string | null | undefined,
  fieldKey: string,
  value: string | null,
): string | null | undefined {
  const v = normalise(value);
  if (fieldKey === "confirmation_signed_received" && v === "yes") return "signed_received";
  if (fieldKey === "confirmation_couriered" && v) return "couriered";
  if (fieldKey === "confirmation_made" && v === "yes") return "made";
  return current;
}

function deriveOptimisticApprovalStatus(
  current: string | null | undefined,
  fieldKey: string,
  value: string | null,
): string | null | undefined {
  const v = normalise(value);
  if (fieldKey === "approval_required") {
    if (v === "not required") return "not_required";
    if (v === "required" && current && ["received", "approved"].includes(current)) return current;
    if (v === "required") return "pending";
  }
  if (fieldKey === "approval_received_on" && v) return "received";
  return current;
}

export function patchEventSnapshotFromChecklistField(
  snapshot: OptimisticEventSnapshot,
  fieldKey: string,
  value: string | null,
): OptimisticEventSnapshot {
  const next = { ...snapshot };
  if (fieldKey === "payment_status") next.payment_status = value;
  const confirmation = deriveOptimisticConfirmationStatus(next.confirmation_status, fieldKey, value);
  if (confirmation !== undefined) next.confirmation_status = confirmation;
  const approval = deriveOptimisticApprovalStatus(next.approval_status, fieldKey, value);
  if (approval !== undefined) next.approval_status = approval;
  return next;
}

export function patchEventDetailCache<T extends { event: Record<string, unknown> }>(
  data: T,
  fieldKey: string,
  value: string | null,
): T {
  const snapshot = patchEventSnapshotFromChecklistField(eventSnapshotFromDetail(data.event), fieldKey, value);
  return {
    ...data,
    event: {
      ...data.event,
      approval_status: snapshot.approval_status,
      confirmation_status: snapshot.confirmation_status,
      payment_status: snapshot.payment_status ?? data.event.payment_status,
    },
  };
}

export function recomputeOptimisticLifecycle(
  data: ChecklistCacheResponse,
  snapshot: OptimisticEventSnapshot,
): ChecklistCacheResponse["lifecycle"] {
  const event: EventLifecycleRow = {
    id: "optimistic",
    title: "",
    status: snapshot.status,
    event_type: snapshot.event_type,
    approval_status: snapshot.approval_status,
    confirmation_status: snapshot.confirmation_status,
    poc_complete: snapshot.poc_complete,
    costing_email: checklistValueByKey(data, "costing_email") ?? null,
    payment_status: checklistValueByKey(data, "payment_status") ?? snapshot.payment_status ?? null,
    ops_completion: null,
    accounts_completion: null,
    overall_completion: null,
  };
  return buildLifecycleReadiness(event);
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

function setDependentStatuses(keys: Iterable<string>, status: string, data: ChecklistCacheResponse): void {
  const keySet = keys instanceof Set ? keys : new Set(keys);
  forEachChecklistItem(data, (item) => {
    if (keySet.has(item.field_key)) item.status = status;
  });
}

/** Apply optimistic value + visibility side-effects before the server round-trip. */
export function applyOptimisticChecklistUpdate(
  data: ChecklistCacheResponse,
  item: Pick<ChecklistCacheItem, "id" | "field_key" | "field_type">,
  value: string | null,
  status?: string,
  eventSnapshot?: OptimisticEventSnapshot | null,
): ChecklistCacheResponse {
  const next: ChecklistCacheResponse = structuredClone(data);
  let updated = false;

  forEachChecklistItem(next, (row) => {
    if (row.id !== item.id) return;
    row.value = value;
    row.status = optimisticFieldStatus(item.field_type, value, status);
    if (item.field_type === "date") row.due_date = value;
    updated = true;
  });
  if (!updated) return data;

  const v = normalise(value);
  if (item.field_key === "onstage_required") {
    setDependentStatuses(
      ONSTAGE_DEPENDENT_FIELD_KEYS,
      v === "not required" ? "not_applicable" : "not_started",
      next,
    );
  }
  if (item.field_key === "emailer") {
    setDependentStatuses(
      EMAILER_DEPENDENT_FIELD_KEYS,
      v === "yes" ? "not_started" : "not_applicable",
      next,
    );
  }
  if (item.field_key === "approval_required") {
    setDependentStatuses(
      APPROVAL_DEPENDENT_FIELD_KEYS,
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
    setDependentStatuses(
      NOC_DEPENDENT_FIELD_KEYS,
      v === "sent" ? "not_started" : "not_applicable",
      next,
    );
  }
  if (item.field_key === "tds_certificate_from_client") {
    setDependentStatuses(
      TDS_DEPENDENT_FIELD_KEYS,
      v === "received" ? "not_started" : "not_applicable",
      next,
    );
  }

  if (eventSnapshot) {
    const patched = patchEventSnapshotFromChecklistField(eventSnapshot, item.field_key, value);
    next.lifecycle = recomputeOptimisticLifecycle(next, patched);
  }

  return next;
}

export function mergeChecklistItem(
  data: ChecklistCacheResponse,
  item: ChecklistCacheItem,
  eventSnapshot?: OptimisticEventSnapshot | null,
): ChecklistCacheResponse {
  const next: ChecklistCacheResponse = structuredClone(data);
  forEachChecklistItem(next, (row) => {
    if (row.id === item.id) Object.assign(row, item);
  });
  if (eventSnapshot) {
    next.lifecycle = recomputeOptimisticLifecycle(next, eventSnapshot);
  }
  return next;
}
