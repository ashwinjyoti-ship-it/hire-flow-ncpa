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
  // ===== EVENT OPERATIONS CHECKLIST (14 sections) =====

  // 1. EVENT REFERENCE
  { module: "operations", section: "Event Reference", field_key: "event_name", label: "Event Name", field_type: "text" },
  { module: "operations", section: "Event Reference", field_key: "event_type", label: "Event Type", field_type: "dropdown", options: ["EE", "FR", "VFH", "Free Event"] },
  { module: "operations", section: "Event Reference", field_key: "nature_of_event", label: "Nature of Event", field_type: "text" },
  { module: "operations", section: "Event Reference", field_key: "venue", label: "Venue", field_type: "dropdown", options: ["JBT", "TATA", "TET", "LT", "GDT", "OAP", "JBT BOX", "TATA GARDEN", "TET GARDEN", "SUNKEN GARDEN", "WEST ROOM 1", "SVR", "TATA LOBBY", "JBT LOBBY"] },

  // 2. POINT OF CONTACT
  { module: "operations", section: "Point of Contact", field_key: "poc_name", label: "POC Name", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "poc_contact_number", label: "Contact Number", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "poc_email", label: "Email", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "event_company_contact_name", label: "Event Company Contact Name", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "event_company_contact_number", label: "Event Company Contact Number", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "event_company_email", label: "Event Company Email", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "bank_details", label: "Bank Details", field_type: "textarea" },
  { module: "operations", section: "Point of Contact", field_key: "gst_no", label: "GST No.", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "tan_no", label: "TAN No.", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "pan_no", label: "PAN No.", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "signing_authority_address", label: "Signing Authority & Address", field_type: "textarea" },
  { module: "operations", section: "Point of Contact", field_key: "courier_address", label: "Courier Address", field_type: "textarea" },
  { module: "operations", section: "Point of Contact", field_key: "vendor_registration_form", label: "Vendor Registration Form", field_type: "dropdown", options: ["Pending", "Received", "No Applicable"], default_value: "No Applicable" },

  // 3. APPROVAL (VFH only)
  // When Approval Required? = Not Required, the rest of this section is skipped:
  // dependent fields are hidden (visibility_rule) and marked not_applicable.
  { module: "operations", section: "Approval", field_key: "approval_required", label: "Approval Required?", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required", vfh_only: true },
  { module: "operations", section: "Approval", field_key: "approval_sent_on", label: "Approval Sent On", field_type: "date", vfh_only: true, visibility_rule: "onlyWhen(approval_required == Required)", triggers_task: { rule: "approval_followup", title: "Follow up on Approval", due_after_days: 7, complete_when: "Approval is Received or the event becomes Approved" } },
  { module: "operations", section: "Approval", field_key: "approval_received_on", label: "Approval Received On", field_type: "date", vfh_only: true, visibility_rule: "onlyWhen(approval_required == Required)" },
  { module: "operations", section: "Approval", field_key: "genre_head", label: "Genre Head", field_type: "text", vfh_only: true, visibility_rule: "onlyWhen(approval_required == Required)" },

  // 4. EVENT DATES
  { module: "operations", section: "Event Dates", field_key: "setup_date", label: "Setup Date", field_type: "date" },
  { module: "operations", section: "Event Dates", field_key: "rehearsal_date", label: "Rehearsal Date", field_type: "date" },
  { module: "operations", section: "Event Dates", field_key: "event_dates", label: "Event Date(s)", field_type: "text" },
  { module: "operations", section: "Event Dates", field_key: "dismantling_date", label: "Dismantling Date", field_type: "date" },

  // 5. TIMINGS (AC/Non-AC with auto hours)
  { module: "operations", section: "Timings", field_key: "timings_with_ac", label: "Timings — With AC", field_type: "textarea" },
  { module: "operations", section: "Timings", field_key: "ac_hours", label: "AC Hours (auto)", field_type: "computed", is_computed: true, default_value: "—" },
  { module: "operations", section: "Timings", field_key: "timings_without_ac", label: "Timings — Without AC", field_type: "textarea" },
  { module: "operations", section: "Timings", field_key: "non_ac_hours", label: "Non-AC Hours (auto)", field_type: "computed", is_computed: true, default_value: "—" },

  // 6. FINANCIALS
  // The Costing Email is the first post-inquiry financial step and a hard gate
  // to confirmation. Each field defaults to "not done"; a positive entry (Yes /
  // Sent / Completed) marks progress. Payment Status = Completed is the only
  // other finance blocker to confirmation. Instalment is NOT a blocker — it
  // only drives reminder tasks; the team decides by updating Payment Status.
  { module: "operations", section: "Financials", field_key: "costing_email", label: "Costing Email", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  // "Not Applicable" — a client may not need a proforma invoice.
  { module: "operations", section: "Financials", field_key: "proforma_invoice", label: "Proforma Invoice", field_type: "dropdown", options: ["Not Sent", "Sent", "Not Applicable"], default_value: "Not Sent" },
  { module: "operations", section: "Financials", field_key: "instalment", label: "Instalment", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  { module: "operations", section: "Financials", field_key: "installment_1_expected_date", label: "Installment 1 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 1", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_2_expected_date", label: "Installment 2 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 2", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_3_expected_date", label: "Installment 3 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 3", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_4_expected_date", label: "Installment 4 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 4", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_5_expected_date", label: "Installment 5 — Expected Date", field_type: "date", visibility_rule: "onlyWhen(instalment == Yes)", triggers_task: { rule: "instalment", title: "Follow up: Installment 5", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "payment_status", label: "Payment Status", field_type: "dropdown", options: ["Incomplete", "Completed"], default_value: "Incomplete" },

  // 7. CONFIRMATION LETTER
  { module: "operations", section: "Confirmation Letter", field_key: "confirmation_made", label: "Made", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  { module: "operations", section: "Confirmation Letter", field_key: "confirmation_couriered", label: "Couriered", field_type: "date", triggers_task: { rule: "confirmation_letter", title: "Follow up on Confirmation Letter", due_after_days: 3, complete_when: "signed confirmation is received" } },
  { module: "operations", section: "Confirmation Letter", field_key: "confirmation_signed_received", label: "Signed Copy Received", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },

  // 8. EVENT REQUIREMENTS (section rollup — mirrors event form cards)
  { module: "operations", section: "Event Requirements", field_key: "exec_sound_light", label: "Sound & Light", field_type: "dropdown", options: ["Not started", "Captured on form", "Verified", "Not applicable"], default_value: "Not started" },
  { module: "operations", section: "Event Requirements", field_key: "exec_staffing", label: "Staffing & Facilities", field_type: "dropdown", options: ["Not started", "Captured on form", "Verified", "Not applicable"], default_value: "Not started" },
  { module: "operations", section: "Event Requirements", field_key: "exec_recording_special", label: "Recording & Special", field_type: "dropdown", options: ["Not started", "Captured on form", "Verified", "Not applicable"], default_value: "Not started" },
  { module: "operations", section: "Event Requirements", field_key: "exec_catering_decorator", label: "Catering / Decorator", field_type: "dropdown", options: ["Not started", "Captured on form", "Verified", "Not applicable"], default_value: "Not started" },
  { module: "operations", section: "Event Requirements", field_key: "exec_operations", label: "Operations", field_type: "dropdown", options: ["Not started", "Captured on form", "Verified", "Not applicable"], default_value: "Not started" },
  { module: "operations", section: "Event Requirements", field_key: "exec_additional", label: "Additional Requirements", field_type: "dropdown", options: ["Not started", "Captured on form", "Verified", "Not applicable"], default_value: "Not started" },

  // 9. NOC
  { module: "operations", section: "NOC", field_key: "noc_sent", label: "NOC Sent?", field_type: "dropdown", options: ["Not sent", "Sent"], default_value: "Not sent" },
  { module: "operations", section: "NOC", field_key: "noc_sent_on", label: "Date Sent", field_type: "date", visibility_rule: "onlyWhen(noc_sent == Sent)" },

  // 10. ONSTAGE (sequential pipeline)
  { module: "operations", section: "OnStage", field_key: "onstage_asked_client", label: "OnStage — Asked Client", field_type: "date", triggers_task: { rule: "onstage", title: "Follow up for OnStage information", due_after_days: 3, complete_when: "marked Received" } },
  { module: "operations", section: "OnStage", field_key: "onstage_received_from_client", label: "OnStage — Received from Client", field_type: "date" },
  { module: "operations", section: "OnStage", field_key: "onstage_sent_to_team", label: "OnStage — Sent to Team", field_type: "date" },
  { module: "operations", section: "OnStage", field_key: "onstage_verified", label: "OnStage — Verified", field_type: "date" },
  { module: "operations", section: "OnStage", field_key: "onstage_complete", label: "OnStage — Complete", field_type: "date" },
  { module: "operations", section: "OnStage", field_key: "monthly_chart_sent", label: "SENT for Monthly Chart", field_type: "dropdown", options: ["Not sent", "Sent"], default_value: "Not sent" },

  // 11. TECHNICAL MEETING & MINUTES
  { module: "operations", section: "Technical Meeting & Minutes", field_key: "technical_meeting_date", label: "Technical Meeting Date", field_type: "date", triggers_task: { rule: "technical_meeting", title: "Technical Meeting", due_after_days: 0, complete_when: "the meeting date passes" } },
  { module: "operations", section: "Technical Meeting & Minutes", field_key: "minutes_of_meeting", label: "Minutes of Meeting", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },

  // 12. OPERATIONS DETAILS
  { module: "operations", section: "Operations Details", field_key: "no_of_crew_cards", label: "No. of Crew Cards", field_type: "number" },
  { module: "operations", section: "Operations Details", field_key: "house_seats", label: "House Seats", field_type: "number" },
  { module: "operations", section: "Operations Details", field_key: "licenses_status", label: "Licences — Required", field_type: "dropdown", options: ["Not required", "Received"], default_value: "Not required" },
  { module: "operations", section: "Operations Details", field_key: "licenses", label: "Licenses — Types (PPL/IPRS etc.)", field_type: "textarea" },
  { module: "operations", section: "Operations Details", field_key: "decorator_name", label: "Decorator — Name", field_type: "text" },
  { module: "operations", section: "Operations Details", field_key: "decorator_tier", label: "Decorator — Tier", field_type: "dropdown", options: ["A", "B", "C", "D", "E"] },
  { module: "operations", section: "Operations Details", field_key: "caterer_name", label: "Caterer — Name", field_type: "text" },
  { module: "operations", section: "Operations Details", field_key: "caterer_tier", label: "Caterer — Tier", field_type: "dropdown", options: ["A", "B", "C", "D", "E"] },
  { module: "operations", section: "Operations Details", field_key: "type_of_catering", label: "Type of Catering", field_type: "dropdown", options: ["Veg", "Non-Veg", "Veg & Non-Veg", "Tea/Coffee", "Snacks", "Custom"] },
  { module: "operations", section: "Operations Details", field_key: "no_of_pax", label: "No. of Pax", field_type: "number" },

  // 13. POST-EVENT CLOSURE
  { module: "operations", section: "Post-Event Closure", field_key: "feedback_sent", label: "Feedback Form — Sent", field_type: "date", triggers_task: { rule: "feedback", title: "Follow up on Feedback", due_after_days: 5, complete_when: "marked Received" } },
  { module: "operations", section: "Post-Event Closure", field_key: "feedback_received", label: "Feedback Form — Received", field_type: "date" },
  { module: "operations", section: "Post-Event Closure", field_key: "event_report", label: "Event Report", field_type: "dropdown", options: ["Not Ready", "Ready"], default_value: "Not Ready" },
  { module: "operations", section: "Post-Event Closure", field_key: "box_office_statement", label: "Box Office Statement", field_type: "dropdown", options: ["Awaiting", "Received"], default_value: "Awaiting" },

  // ===== ACCOUNTS TRACKING CHECKLIST =====
  // Note: 3-day follow-up is automatic via accounts_file task on file_sent_to_accounts.

  // A1. FILE TRACKING
  { module: "accounts", section: "File Tracking", field_key: "file_sent_to_accounts", label: "File Sent to Accounts — Date", field_type: "date", triggers_task: { rule: "accounts_file", title: "Follow up with Accounts", due_after_days: 3, complete_when: "Final File is Received" } },
  { module: "accounts", section: "File Tracking", field_key: "file_received_back_edit_1", label: "File Received Back — Edit 1", field_type: "dropdown", options: ["Pending", "Received"], default_value: "Pending" },
  { module: "accounts", section: "File Tracking", field_key: "file_received_back_edit_2", label: "File Received Back — Edit 2", field_type: "dropdown", options: ["Pending", "Received"], default_value: "Pending" },
  { module: "accounts", section: "File Tracking", field_key: "final_file_received", label: "Final File Received", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },

  // A2. PAYMENT & REFUND TRACKING
  { module: "accounts", section: "Payment & Refund", field_key: "security_deposit_refund", label: "Security Deposit Refund", field_type: "dropdown", options: ["N/A", "Applicable"], default_value: "N/A" },
  { module: "accounts", section: "Payment & Refund", field_key: "box_office_collection_refund", label: "Box Office Collection Refund", field_type: "dropdown", options: ["N/A", "Applicable"], default_value: "N/A" },
  { module: "accounts", section: "Payment & Refund", field_key: "payment_advice", label: "Payment Advice", field_type: "dropdown", options: ["Awaiting", "Received"], default_value: "Awaiting" },
  { module: "accounts", section: "Payment & Refund", field_key: "tds_certificate_refund_and_payment_advice", label: "TDS Certificate Refund & Payment Advice", field_type: "dropdown", options: ["Awaiting", "Received"], default_value: "Awaiting" },
  { module: "accounts", section: "Payment & Refund", field_key: "payment_ledger", label: "Payment Ledger", field_type: "dropdown", options: ["Requested", "Received"], default_value: "Requested" },

  // B. TO CLIENT (outbound documents)
  { module: "accounts", section: "To Client", field_key: "tax_invoice_sent", label: "Tax Invoice — Sent?", field_type: "dropdown", options: ["Not Sent", "Sent"], default_value: "Not Sent" },
  { module: "accounts", section: "To Client", field_key: "box_office_statement_sent", label: "Box Office Statement — Sent?", field_type: "dropdown", options: ["Not Sent", "Sent", "Not Applicable"], default_value: "Not Sent" },
  { module: "accounts", section: "To Client", field_key: "payment_advice_received_from_client", label: "Payment Advice — Received from Client?", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  { module: "accounts", section: "To Client", field_key: "tds_certificate_from_client", label: "TDS Certificate — From Client", field_type: "dropdown", options: ["N.A.", "Awaiting", "Received"], default_value: "N.A." },
  { module: "accounts", section: "To Client", field_key: "tds_payment_and_advice_sent", label: "TDS Payment & Advice — Sent?", field_type: "dropdown", options: ["Awaiting", "Sent"], default_value: "Awaiting" },
  { module: "accounts", section: "To Client", field_key: "payment_ledger_sent", label: "Payment Ledger — Sent?", field_type: "dropdown", options: ["Requested", "Sent"], default_value: "Requested" },

  // B2. TDS CERTIFICATE PROCESSING (client ↔ accounts) — visible when TDS from client = Received
  { module: "accounts", section: "TDS Certificate Processing", field_key: "tds_received_from_client_date", label: "TDS Received from Client — Date", field_type: "date", visibility_rule: "onlyWhen(tds_certificate_from_client == Received)", triggers_task: { rule: "tds_send_to_accounts", title: "Send TDS certificate to Accounts", due_after_days: 0, complete_when: "TDS Certificate Sent to Accounts date is set" } },
  { module: "accounts", section: "TDS Certificate Processing", field_key: "tds_certificate_sent_to_accounts", label: "TDS Certificate Sent to Accounts — Date", field_type: "date", visibility_rule: "onlyWhen(tds_certificate_from_client == Received)" },
  { module: "accounts", section: "TDS Certificate Processing", field_key: "tds_accounts_refund_or_action", label: "Accounts Refund / Payment Action", field_type: "dropdown", options: ["Awaiting", "Refunded", "Payment Processed", "N/A"], default_value: "Awaiting", visibility_rule: "onlyWhen(tds_certificate_from_client == Received)" },
  { module: "accounts", section: "TDS Certificate Processing", field_key: "tds_proof_sent_to_client", label: "Proof Sent to Client", field_type: "dropdown", options: ["Not Sent", "Sent"], default_value: "Not Sent", visibility_rule: "onlyWhen(tds_certificate_from_client == Received)" },

  // C. ACCOUNTS STATUS SUMMARY (computed, read-only)
  { module: "accounts", section: "Accounts Status Summary", field_key: "accounts_file_status", label: "Accounts File Status", field_type: "computed", is_computed: true, default_value: "Open" },
  { module: "accounts", section: "Accounts Status Summary", field_key: "outstanding_to_client", label: "Outstanding to Client", field_type: "computed", is_computed: true, default_value: "—" },
  { module: "accounts", section: "Accounts Status Summary", field_key: "notifications_triggered", label: "Notifications Triggered", field_type: "computed", is_computed: true, default_value: "0" },
];
