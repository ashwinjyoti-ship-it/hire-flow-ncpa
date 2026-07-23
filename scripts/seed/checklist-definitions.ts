/**
 * Checklist template definitions — verbatim from:
 *   - Event Operations Accounts Forms v2.1.xlsx → "Event Operations Checklist" (14 sections)
 *   - Event Operations Accounts Forms v2.1.xlsx → "Accounts Tracking"
 *   - build_forms.py Agent Guide (state machines + conditional rules)
 *
 * Each definition becomes a row in checklist_definitions and is instantiated
 * per-event in checklist_items when an event is created.
 */

export interface ChecklistDefSeed {
  module: "operations" | "accounts";
  section: string;
  field_key: string;
  label: string;
  field_type: "text" | "textarea" | "number" | "date" | "dropdown" | "status" | "checkbox" | "computed";
  options?: string[];
  default_value?: string;
  vfh_only?: boolean;
  is_computed?: boolean;
  /** Task-rule descriptor: when this field is set, generate a follow-up task. */
  triggers_task?: {
    rule: string;
    title: string;
    due_after_days: number;
    complete_when?: string;
  };
  /**
   * Conditional-visibility descriptor. Rendered (UI) only; the field stays
   * persisted server-side regardless. Grammar: `onlyWhen(<fieldKey> == <value>)`.
   * Example: `onlyWhen(instalment == Yes)` shows the field only when the
   * `instalment` checklist field equals "Yes".
   */
  visibility_rule?: string;
}

export const CHECKLIST_DEFINITIONS: ChecklistDefSeed[] = [
  // ===== EVENT OPERATIONS ACTION CHECKLIST =====

  // 1. EVENT REFERENCE
  { module: "operations", section: "Event Reference", field_key: "event_name", label: "Event Name", field_type: "computed", is_computed: true },
  { module: "operations", section: "Event Reference", field_key: "event_dates", label: "Event Date(s)", field_type: "computed", is_computed: true },
  { module: "operations", section: "Event Reference", field_key: "venue", label: "Venue", field_type: "computed", is_computed: true },
  { module: "operations", section: "Event Reference", field_key: "event_type", label: "Event Type", field_type: "computed", is_computed: true },

  // 3. APPROVAL (VFH only)
  // When Approval Required? = Not Required, the rest of this section is skipped:
  // dependent fields are hidden (visibility_rule) and marked not_applicable.
  { module: "operations", section: "Approval", field_key: "approval_required", label: "Approval Required?", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required", vfh_only: true },
  { module: "operations", section: "Approval", field_key: "approval_sent_on", label: "Approval Sent On", field_type: "date", vfh_only: true, visibility_rule: "onlyWhen(approval_required == Required)", triggers_task: { rule: "approval_followup", title: "Follow up on Approval", due_after_days: 7, complete_when: "Approval is Received or the event becomes Approved" } },
  { module: "operations", section: "Approval", field_key: "approval_received_on", label: "Approval Received On", field_type: "date", vfh_only: true, visibility_rule: "onlyWhen(approval_required == Required)" },
  { module: "operations", section: "Approval", field_key: "genre_head", label: "Genre Head", field_type: "text", vfh_only: true, visibility_rule: "onlyWhen(approval_required == Required)" },

  // 5. FINANCIALS
  // The Costing Email is the first post-inquiry financial step and a hard gate
  // to confirmation. Each field defaults to "not done"; a positive entry (Yes /
  // Sent / Completed) marks progress. Payment Status = Completed is the only
  // other finance blocker to confirmation. Instalment is NOT a blocker — it
  // only drives reminder tasks; the team decides by updating Payment Status.
  // Confirmation Letter Couriered / Signed also require these financials first
  // (Proforma Sent or Not Applicable). Made may still be set earlier.
  // Couriered requires Made; Signed requires Couriered.
  { module: "operations", section: "Financials", field_key: "costing_email", label: "Costing Email", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  // "Not Applicable" — a client may not need a proforma invoice; that still
  // satisfies the Confirmation Letter delivery gate.
  { module: "operations", section: "Financials", field_key: "proforma_invoice", label: "Proforma Invoice", field_type: "dropdown", options: ["Not Sent", "Sent", "Not Applicable"], default_value: "Not Sent" },
  { module: "operations", section: "Financials", field_key: "instalment", label: "Instalment", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  { module: "operations", section: "Financials", field_key: "installment_1_expected_date", label: "Installment 1 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 1", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_2_expected_date", label: "Installment 2 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 2", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_3_expected_date", label: "Installment 3 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 3", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_4_expected_date", label: "Installment 4 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 4", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_5_expected_date", label: "Installment 5 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 5", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "payment_status", label: "Payment Status", field_type: "dropdown", options: ["Incomplete", "Completed"], default_value: "Incomplete" },

  // 6. CONFIRMATION LETTER
  { module: "operations", section: "Confirmation Letter", field_key: "confirmation_made", label: "Made", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  { module: "operations", section: "Confirmation Letter", field_key: "confirmation_couriered", label: "Couriered", field_type: "date", triggers_task: { rule: "confirmation_letter", title: "Follow up on Confirmation Letter", due_after_days: 3, complete_when: "signed confirmation is received" } },
  { module: "operations", section: "Confirmation Letter", field_key: "confirmation_signed_received", label: "Signed Copy Received", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },

  // 8. NOC
  { module: "operations", section: "NOC", field_key: "noc_sent", label: "NOC Sent?", field_type: "dropdown", options: ["Not Applicable", "Not sent", "Sent"], default_value: "Not sent" },
  { module: "operations", section: "NOC", field_key: "noc_sent_on", label: "Date Sent", field_type: "date", visibility_rule: "onlyWhen(noc_sent == Sent)" },

  // 9. ONSTAGE / EMAILER (one section; independent Yes/No gates)
  // OnStage Required? only collapses the OnStage pipeline — Emailer is separate.
  { module: "operations", section: "Onstage/Emailer", field_key: "onstage_required", label: "OnStage Required?", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Required" },
  { module: "operations", section: "Onstage/Emailer", field_key: "onstage_asked_client", label: "OnStage — Asked Client", field_type: "date", visibility_rule: "onlyWhen(onstage_required == Required)", triggers_task: { rule: "onstage", title: "Follow up for OnStage information", due_after_days: 3, complete_when: "marked Received" } },
  { module: "operations", section: "Onstage/Emailer", field_key: "onstage_received_from_client", label: "OnStage — Received from Client", field_type: "date", visibility_rule: "onlyWhen(onstage_required == Required)" },
  { module: "operations", section: "Onstage/Emailer", field_key: "onstage_sent_to_team", label: "OnStage — Sent to Team", field_type: "date", visibility_rule: "onlyWhen(onstage_required == Required)" },
  { module: "operations", section: "Onstage/Emailer", field_key: "onstage_verified", label: "OnStage — Verified", field_type: "date", visibility_rule: "onlyWhen(onstage_required == Required)" },
  { module: "operations", section: "Onstage/Emailer", field_key: "onstage_complete", label: "OnStage — Complete", field_type: "date", visibility_rule: "onlyWhen(onstage_required == Required)" },
  { module: "operations", section: "Onstage/Emailer", field_key: "emailer", label: "Emailer", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  { module: "operations", section: "Onstage/Emailer", field_key: "emailer_asked_client", label: "Emailer — Asked Client", field_type: "date", visibility_rule: "onlyWhen(emailer == Yes)" },
  { module: "operations", section: "Onstage/Emailer", field_key: "emailer_received_from_client", label: "Emailer — Received from Client", field_type: "date", visibility_rule: "onlyWhen(emailer == Yes)" },
  { module: "operations", section: "Onstage/Emailer", field_key: "emailer_sent_to_team", label: "Emailer — Sent to Team", field_type: "date", visibility_rule: "onlyWhen(emailer == Yes)" },
  { module: "operations", section: "Onstage/Emailer", field_key: "emailer_sent", label: "Emailer — Sent", field_type: "date", visibility_rule: "onlyWhen(emailer == Yes)" },

  // 10. MONTHLY CHART (directly below Onstage/Emailer)
  { module: "operations", section: "Monthly Chart", field_key: "monthly_chart_sent", label: "SENT for Monthly Chart", field_type: "dropdown", options: ["Not sent", "Sent"], default_value: "Not sent" },

  // 11. TECHNICAL MEETING & MINUTES
  { module: "operations", section: "Technical Meeting & Minutes", field_key: "technical_meeting_date", label: "Technical Meeting Date", field_type: "date", triggers_task: { rule: "technical_meeting", title: "Technical Meeting", due_after_days: 0, complete_when: "the meeting date is entered" } },
  { module: "operations", section: "Technical Meeting & Minutes", field_key: "minutes_of_meeting", label: "Minutes of Meeting", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },

  // POST-EVENT CLOSURE (last operations section)
  { module: "operations", section: "Post-Event Closure", field_key: "feedback_sent", label: "Feedback Form — Sent", field_type: "date", triggers_task: { rule: "feedback", title: "Follow up on Feedback", due_after_days: 5, complete_when: "marked Received" } },
  { module: "operations", section: "Post-Event Closure", field_key: "feedback_received", label: "Feedback Form — Received", field_type: "date" },
  { module: "operations", section: "Post-Event Closure", field_key: "event_report", label: "Event Report", field_type: "dropdown", options: ["Not Ready", "Ready"], default_value: "Not Ready" },
  { module: "operations", section: "Post-Event Closure", field_key: "box_office_statement", label: "Box Office Statement", field_type: "dropdown", options: ["NA", "Awaiting", "Received"], default_value: "NA" },
  { module: "operations", section: "Post-Event Closure", field_key: "final_closure_notes", label: "Final Closure Notes", field_type: "textarea" },
  { module: "operations", section: "Post-Event Closure", field_key: "file_closed", label: "File Closed", field_type: "date" },

  // ===== ACCOUNTS TRACKING CHECKLIST =====
  // File ping-pong with Accounts: sent → edit received → sent back → … → final received.
  // Automatic tasks use accounts_file (follow up) and accounts_file_send_back rules (+3 days by default).

  // A1. FILE TRACKING
  { module: "accounts", section: "File Tracking", field_key: "file_sent_to_accounts", label: "File Sent to Accounts — Date", field_type: "date", triggers_task: { rule: "accounts_file", title: "Follow up with Accounts", due_after_days: 3, complete_when: "Edit 1 or final file received" } },
  { module: "accounts", section: "File Tracking", field_key: "file_received_back_edit_1", label: "File Received Back — Edit 1 — Date", field_type: "date", triggers_task: { rule: "accounts_file_send_back", title: "Send file back to Accounts", due_after_days: 3, complete_when: "Sent back after Edit 1 or final file received" } },
  { module: "accounts", section: "File Tracking", field_key: "file_sent_back_after_edit_1", label: "File Sent Back After Edit 1 — Date", field_type: "date", triggers_task: { rule: "accounts_file", title: "Follow up with Accounts", due_after_days: 3, complete_when: "Edit 2 or final file received" } },
  { module: "accounts", section: "File Tracking", field_key: "file_received_back_edit_2", label: "File Received Back — Edit 2 — Date", field_type: "date", triggers_task: { rule: "accounts_file_send_back", title: "Send file back to Accounts", due_after_days: 3, complete_when: "Sent back after Edit 2 or final file received" } },
  { module: "accounts", section: "File Tracking", field_key: "file_sent_back_after_edit_2", label: "File Sent Back After Edit 2 — Date", field_type: "date", triggers_task: { rule: "accounts_file", title: "Follow up with Accounts", due_after_days: 3, complete_when: "Final file received" } },
  { module: "accounts", section: "File Tracking", field_key: "final_file_received", label: "Final File Received — Date", field_type: "date" },

  // A2. TO ACCOUNTS — PAYMENTS AND REFUNDS
  { module: "accounts", section: "To Accounts-payments and refunds", field_key: "box_office_collection_refund", label: "Box Office Statement", field_type: "dropdown", options: ["N/A", "Applicable"], default_value: "N/A" },
  { module: "accounts", section: "To Accounts-payments and refunds", field_key: "payment_advice", label: "Payment Advice from Accounts", field_type: "dropdown", options: ["Awaiting", "Received"], default_value: "Awaiting" },
  { module: "accounts", section: "To Accounts-payments and refunds", field_key: "payment_ledger", label: "Payment Ledger", field_type: "dropdown", options: ["N/A", "Requested", "Received"], default_value: "Requested" },

  // B. TO CLIENT (outbound documents)
  { module: "accounts", section: "To Client", field_key: "tax_invoice_sent", label: "Tax Invoice — Sent?", field_type: "dropdown", options: ["Not Sent", "Sent"], default_value: "Not Sent" },
  { module: "accounts", section: "To Client", field_key: "box_office_statement_sent", label: "Box Office Statement — Sent?", field_type: "dropdown", options: ["Not Sent", "Sent", "Not Applicable"], default_value: "Not Sent" },
  { module: "accounts", section: "To Client", field_key: "payment_advice_sent_to_client", label: "Payment Advice — Sent to Client?", field_type: "dropdown", options: ["Not Sent", "Sent"], default_value: "Not Sent" },
  { module: "accounts", section: "To Client", field_key: "tds_certificate_from_client", label: "TDS Certificate — From Client", field_type: "dropdown", options: ["N.A.", "Awaiting", "Received"], default_value: "N.A." },
  { module: "accounts", section: "To Client", field_key: "payment_ledger_sent", label: "Payment Ledger — Sent?", field_type: "dropdown", options: ["Requested", "Sent"], default_value: "Requested" },

  // B2. TDS CERTIFICATE PROCESSING (client ↔ accounts) — visible when TDS from client = Received
  { module: "accounts", section: "TDS Certificate Processing", field_key: "tds_received_from_client_date", label: "TDS Received from Client — Date", field_type: "date", visibility_rule: "onlyWhen(tds_certificate_from_client == Received)", triggers_task: { rule: "tds_send_to_accounts", title: "Send TDS certificate to Accounts", due_after_days: 0, complete_when: "TDS Certificate Sent to Accounts date is set" } },
  { module: "accounts", section: "TDS Certificate Processing", field_key: "tds_certificate_sent_to_accounts", label: "TDS Certificate Sent to Accounts — Date", field_type: "date", visibility_rule: "onlyWhen(tds_certificate_from_client == Received)" },
  { module: "accounts", section: "TDS Certificate Processing", field_key: "tds_accounts_refund_or_action", label: "Accounts Refund / Payment Action", field_type: "dropdown", options: ["Awaiting", "Refunded", "Payment Processed", "N/A"], default_value: "Awaiting", visibility_rule: "onlyWhen(tds_certificate_from_client == Received)" },
  { module: "accounts", section: "TDS Certificate Processing", field_key: "tds_proof_sent_to_client", label: "Proof Sent to Client", field_type: "dropdown", options: ["Not Sent", "Sent"], default_value: "Not Sent", visibility_rule: "onlyWhen(tds_certificate_from_client == Received)" },
];
