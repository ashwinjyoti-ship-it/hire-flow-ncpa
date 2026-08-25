import { describe, expect, it } from "vitest";
import { blockersForFileClose, formatFileCloseBlockedMessage } from "../lib/file-close";

function tracking(field_key: string, label: string, value: string | null, status?: string) {
  return {
    module: "accounts",
    section: "File Tracking",
    field_key,
    label,
    status: status ?? (value ? "completed" : "not_started"),
    value,
  };
}

const FILE_TRACKING_LABELS: Record<string, string> = {
  file_sent_to_accounts: "File Sent to Accounts — Date",
  file_received_back_edit_1: "File Received Back — Edit 1 — Date",
  file_sent_back_after_edit_1: "File Sent Back After Edit 1 — Date",
  file_received_back_edit_2: "File Received Back — Edit 2 — Date",
  file_sent_back_after_edit_2: "File Sent Back After Edit 2 — Date",
  final_file_received: "Final File Received — Date",
};

function fileTracking(values: Record<string, string | null>, statuses?: Record<string, string>) {
  return Object.entries(FILE_TRACKING_LABELS).map(([field_key, label]) =>
    tracking(field_key, label, values[field_key] ?? null, statuses?.[field_key]),
  );
}

describe("file close gate", () => {
  it("blocks close when post-event or accounts checklist items are incomplete", () => {
    const blockers = blockersForFileClose([
      {
        module: "operations",
        section: "Post-Event Closure",
        field_key: "feedback_received",
        label: "Feedback Form — Received",
        status: "not_started",
        value: null,
      },
      {
        module: "accounts",
        section: "To Client",
        field_key: "tax_invoice_sent",
        label: "Tax Invoice — Sent?",
        status: "in_progress",
        value: "Not Sent",
      },
      {
        module: "operations",
        section: "Post-Event Closure",
        field_key: "file_closed",
        label: "File Closed",
        status: "not_started",
        value: null,
      },
    ]);

    expect(blockers).toEqual([
      "Post-Event Closure: Feedback Form — Received",
      "To Client: Tax Invoice — Sent?",
    ]);
  });

  it("ignores completed, not applicable, and hidden fields", () => {
    const blockers = blockersForFileClose([
      {
        module: "accounts",
        section: "To Client",
        field_key: "payment_ledger_sent",
        label: "Payment Ledger — Sent?",
        status: "completed",
        value: "Sent",
      },
      {
        module: "accounts",
        section: "To Accounts-payments and refunds",
        field_key: "payment_ledger",
        label: "Payment Ledger",
        status: "not_applicable",
        value: "N/A",
      },
      {
        module: "accounts",
        section: "TDS Certificate Processing",
        field_key: "tds_received_from_client_date",
        label: "TDS Received",
        status: "not_started",
        value: null,
        visibility_rule: "onlyWhen(tds_certificate_from_client == Received)",
      },
      {
        module: "accounts",
        section: "To Client",
        field_key: "tds_certificate_from_client",
        label: "TDS Certificate — From Client",
        status: "completed",
        value: "N.A.",
      },
    ]);

    expect(blockers).toEqual([]);
  });

  it("allows close after send + any one received-edit date + final, even if later ping-pong rounds are empty", () => {
    expect(blockersForFileClose(fileTracking({
      file_sent_to_accounts: "2026-08-01",
      file_received_back_edit_1: "2026-08-02",
      final_file_received: "2026-08-03",
    }))).toEqual([]);

    expect(blockersForFileClose(fileTracking({
      file_sent_to_accounts: "2026-08-01",
      file_received_back_edit_2: "2026-08-04",
      final_file_received: "2026-08-05",
    }))).toEqual([]);
  });

  it("blocks close until send, final receipt, and at least one received-edit date are filled", () => {
    expect(blockersForFileClose(fileTracking({
      file_sent_to_accounts: "2026-08-01",
    }))).toEqual([
      "File Tracking: Final File Received — Date",
      "File Tracking: File Received Back — Edit 1 or Edit 2 — Date",
    ]);

    expect(blockersForFileClose(fileTracking({
      file_received_back_edit_1: "2026-08-02",
      final_file_received: "2026-08-03",
    }))).toEqual([
      "File Tracking: File Sent to Accounts — Date",
    ]);
  });

  it("blocks future-dated File Sent or Final File Received even when a value is present", () => {
    expect(blockersForFileClose(fileTracking({
      file_sent_to_accounts: "2099-01-01",
      file_received_back_edit_1: "2026-08-02",
      final_file_received: "2026-08-03",
    }, { file_sent_to_accounts: "in_progress" }))).toEqual([
      "File Tracking: File Sent to Accounts — Date",
    ]);

    expect(blockersForFileClose(fileTracking({
      file_sent_to_accounts: "2026-08-01",
      file_received_back_edit_1: "2026-08-02",
      final_file_received: "2099-01-01",
    }, { final_file_received: "in_progress" }))).toEqual([
      "File Tracking: Final File Received — Date",
    ]);
  });

  it("still blocks other accounts work when ping-pong dates are satisfied", () => {
    const blockers = blockersForFileClose([
      ...fileTracking({
        file_sent_to_accounts: "2026-08-01",
        file_received_back_edit_1: "2026-08-02",
        final_file_received: "2026-08-03",
      }),
      {
        module: "accounts",
        section: "To Client",
        field_key: "tax_invoice_sent",
        label: "Tax Invoice — Sent?",
        status: "in_progress",
        value: "Not Sent",
      },
    ]);

    expect(blockers).toEqual(["To Client: Tax Invoice — Sent?"]);
  });

  it("formats a blocked-close message", () => {
    expect(formatFileCloseBlockedMessage(["To Client: Tax Invoice — Sent?"]))
      .toBe("Cannot close file until the following are completed: To Client: Tax Invoice — Sent?");
  });
});
