import { isPaymentMarkedCompleted } from "../../worker/lib/financial-sequence";
import {
  INSTALMENT_COUNT,
  instalmentExpectedDateFieldKey,
  instalmentReceivedFieldKey,
  isInstalmentReceivedValue,
  type InstalmentChecklistItem,
} from "./instalments";

export const PAYMENT_TASK_SOURCE_RULES = ["instalment", "venue_booking_payment_followup"] as const;

export type PaymentTaskSourceRule = (typeof PAYMENT_TASK_SOURCE_RULES)[number];

export type OpenPaymentTask = {
  title: string;
  source_rule: string | null;
};

export type PaymentCompleteConfirmState = {
  shouldConfirm: boolean;
  instalmentIssues: string[];
  openPaymentTasks: OpenPaymentTask[];
};

function isInstalmentTrackingEnabled(items: InstalmentChecklistItem[]): boolean {
  const instalment = items.find((item) => item.field_key === "instalment")?.value;
  return (instalment ?? "").trim().toLowerCase() === "yes";
}

/** Instalments with an expected date that are not marked received. */
export function getUnreceivedInstalmentNumbers(items: InstalmentChecklistItem[]): number[] {
  const byKey = new Map(items.map((item) => [item.field_key, item.value]));
  const unreceived: number[] = [];
  for (let number = 1; number <= INSTALMENT_COUNT; number += 1) {
    const expectedDate = (byKey.get(instalmentExpectedDateFieldKey(number)) ?? "").trim();
    if (!expectedDate) continue;
    if (!isInstalmentReceivedValue(byKey.get(instalmentReceivedFieldKey(number)))) {
      unreceived.push(number);
    }
  }
  return unreceived;
}

/** True when a later instalment is received before an earlier one with an expected date. */
export function hasOutOfOrderInstalments(items: InstalmentChecklistItem[]): boolean {
  const byKey = new Map(items.map((item) => [item.field_key, item.value]));
  let highestReceived = 0;
  for (let number = 1; number <= INSTALMENT_COUNT; number += 1) {
    if (isInstalmentReceivedValue(byKey.get(instalmentReceivedFieldKey(number)))) {
      highestReceived = number;
    }
  }
  if (!highestReceived) return false;
  for (let number = 1; number < highestReceived; number += 1) {
    const expectedDate = (byKey.get(instalmentExpectedDateFieldKey(number)) ?? "").trim();
    if (!expectedDate) continue;
    if (!isInstalmentReceivedValue(byKey.get(instalmentReceivedFieldKey(number)))) {
      return true;
    }
  }
  return false;
}

export function buildInstalmentIssueMessages(items: InstalmentChecklistItem[]): string[] {
  if (!isInstalmentTrackingEnabled(items)) return [];

  const issues: string[] = [];
  const unreceived = getUnreceivedInstalmentNumbers(items);
  if (hasOutOfOrderInstalments(items)) {
    issues.push("Instalments are not in sequence — an earlier instalment is still open while a later one was received.");
  }
  for (const number of unreceived) {
    issues.push(`Installment ${number} has an expected date but is not marked received.`);
  }
  return issues;
}

export function filterOpenPaymentTasks<T extends OpenPaymentTask & { status: string }>(
  tasks: T[],
): T[] {
  return tasks.filter((task) => {
    if (task.status === "completed" || task.status === "cancelled") return false;
    if (task.source_rule && (PAYMENT_TASK_SOURCE_RULES as readonly string[]).includes(task.source_rule)) {
      return true;
    }
    const haystack = task.title.toLowerCase();
    return haystack.includes("payment") || haystack.includes("installment") || haystack.includes("instalment");
  });
}

export function buildPaymentCompleteConfirmState(input: {
  currentPaymentStatus: string | null | undefined;
  nextPaymentStatus: string | null | undefined;
  checklistItems: InstalmentChecklistItem[];
  openTasks: Array<OpenPaymentTask & { status: string }>;
}): PaymentCompleteConfirmState {
  const completing = isPaymentMarkedCompleted(input.nextPaymentStatus)
    && !isPaymentMarkedCompleted(input.currentPaymentStatus);
  if (!completing) {
    return { shouldConfirm: false, instalmentIssues: [], openPaymentTasks: [] };
  }

  const instalmentIssues = buildInstalmentIssueMessages(input.checklistItems);
  const openPaymentTasks = filterOpenPaymentTasks(input.openTasks).map((task) => ({
    title: task.title,
    source_rule: task.source_rule,
  }));

  return {
    shouldConfirm: instalmentIssues.length > 0 || openPaymentTasks.length > 0,
    instalmentIssues,
    openPaymentTasks,
  };
}
