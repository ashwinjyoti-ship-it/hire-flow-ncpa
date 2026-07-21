import { describe, expect, it } from "vitest";
import { blockersForFileClose, formatFileCloseBlockedMessage } from "../lib/file-close";

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

  it("formats a blocked-close message", () => {
    expect(formatFileCloseBlockedMessage(["To Client: Tax Invoice — Sent?"]))
      .toBe("Cannot close file until the following are completed: To Client: Tax Invoice — Sent?");
  });
});
