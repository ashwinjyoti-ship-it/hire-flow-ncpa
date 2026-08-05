import { describe, expect, it } from "vitest";
import {
  buildInstalmentIssueMessages,
  buildPaymentCompleteConfirmState,
  filterOpenPaymentTasks,
  getUnreceivedInstalmentNumbers,
  hasOutOfOrderInstalments,
} from "./payment-complete-confirm";

describe("payment-complete-confirm", () => {
  const baseItems = [
    { field_key: "instalment", value: "Yes" },
    { field_key: "installment_1_expected_date", value: "2026-08-01" },
    { field_key: "installment_1_received", value: null },
    { field_key: "installment_2_expected_date", value: "2026-09-01" },
    { field_key: "installment_2_received", value: "true" },
  ];

  it("detects unreceived instalments with expected dates", () => {
    expect(getUnreceivedInstalmentNumbers(baseItems)).toEqual([1]);
  });

  it("detects out-of-order instalments", () => {
    expect(hasOutOfOrderInstalments(baseItems)).toBe(true);
  });

  it("builds instalment issue messages when tracking is enabled", () => {
    const issues = buildInstalmentIssueMessages(baseItems);
    expect(issues.some((issue) => issue.includes("not in sequence"))).toBe(true);
    expect(issues.some((issue) => issue.includes("Installment 1"))).toBe(true);
  });

  it("ignores instalment issues when instalment tracking is off", () => {
    expect(buildInstalmentIssueMessages([
      { field_key: "instalment", value: "No" },
      { field_key: "installment_1_expected_date", value: "2026-08-01" },
    ])).toEqual([]);
  });

  it("filters open payment-family tasks", () => {
    const tasks = filterOpenPaymentTasks([
      { title: "Follow up: Installment 1", source_rule: "instalment", status: "open" },
      { title: "Follow up with client for payment — JBT", source_rule: "venue_booking_payment_followup", status: "open" },
      { title: "Prepare confirmation letter", source_rule: "confirmation_make", status: "open" },
      { title: "Follow up: Installment 2", source_rule: "instalment", status: "completed" },
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.source_rule)).toEqual(["instalment", "venue_booking_payment_followup"]);
  });

  it("requires confirmation when completing payment with gaps", () => {
    const state = buildPaymentCompleteConfirmState({
      currentPaymentStatus: "Incomplete",
      nextPaymentStatus: "Completed",
      checklistItems: baseItems,
      openTasks: [
        { title: "Follow up: Installment 1", source_rule: "instalment", status: "open" },
      ],
    });
    expect(state.shouldConfirm).toBe(true);
    expect(state.instalmentIssues.length).toBeGreaterThan(0);
    expect(state.openPaymentTasks).toHaveLength(1);
  });

  it("skips confirmation when payment is already completed", () => {
    expect(buildPaymentCompleteConfirmState({
      currentPaymentStatus: "Completed",
      nextPaymentStatus: "Completed",
      checklistItems: baseItems,
      openTasks: [{ title: "Follow up: Installment 1", source_rule: "instalment", status: "open" }],
    }).shouldConfirm).toBe(false);
  });

  it("skips confirmation when there are no instalment or payment-task gaps", () => {
    expect(buildPaymentCompleteConfirmState({
      currentPaymentStatus: "Incomplete",
      nextPaymentStatus: "Completed",
      checklistItems: [
        { field_key: "instalment", value: "No" },
      ],
      openTasks: [{ title: "Prepare confirmation letter", source_rule: "confirmation_make", status: "open" }],
    }).shouldConfirm).toBe(false);
  });
});
