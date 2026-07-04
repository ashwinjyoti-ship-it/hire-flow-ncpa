/**
 * Checklist template definitions — verbatim from:
 *   - Event Operations Accounts Forms v2.1.xlsx → "Event Operations Checklist" (14 sections)
 *   - Event Operations Accounts Forms v2.1.xlsx → "Accounts Tracking" (3 sections)
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
}

export const CHECKLIST_DEFINITIONS: ChecklistDefSeed[] = [
  // ===== EVENT OPERATIONS CHECKLIST (14 sections) =====

  // 1. EVENT REFERENCE
  { module: "operations", section: "Event Reference", field_key: "event_name", label: "Event Name", field_type: "text" },
  { module: "operations", section: "Event Reference", field_key: "event_type", label: "Event Type", field_type: "dropdown", options: ["EE", "FR", "VFH", "Free Event"] },
  { module: "operations", section: "Event Reference", field_key: "nature_of_event", label: "Nature of Event", field_type: "text" },
  { module: "operations", section: "Event Reference", field_key: "venue", label: "Venue", field_type: "dropdown", options: ["JBT", "TATA", "TET", "GDT", "LT", "JBT Box", "OAP", "TATA Garden", "TET Garden", "Sunken Garden", "West Room 1", "SVR"] },

  // 2. POINT OF CONTACT
  { module: "operations", section: "Point of Contact", field_key: "poc_name", label: "POC Name", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "poc_contact_number", label: "Contact Number", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "poc_email", label: "Email", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "bank_details", label: "Bank Details", field_type: "textarea" },
  { module: "operations", section: "Point of Contact", field_key: "gst_no", label: "GST No.", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "tan_no", label: "TAN No.", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "pan_no", label: "PAN No.", field_type: "text" },
  { module: "operations", section: "Point of Contact", field_key: "signing_authority_address", label: "Signing Authority & Address", field_type: "textarea" },
  { module: "operations", section: "Point of Contact", field_key: "courier_address", label: "Courier Address", field_type: "textarea" },
  { module: "operations", section: "Point of Contact", field_key: "vendor_registration_form", label: "Vendor Registration Form", field_type: "dropdown", options: ["Pending", "Received"], default_value: "Pending" },

  // 3. APPROVAL (VFH only)
  { module: "operations", section: "Approval", field_key: "approval_required", label: "Approval Required?", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required", vfh_only: true },
  { module: "operations", section: "Approval", field_key: "approval_sent_on", label: "Approval Sent On", field_type: "date", vfh_only: true, triggers_task: { rule: "approval_followup", title: "Follow up on Approval", due_after_days: 7, complete_when: "Approval is Received or the event becomes Approved" } },
  { module: "operations", section: "Approval", field_key: "approval_received_on", label: "Approval Received On", field_type: "date", vfh_only: true },
  { module: "operations", section: "Approval", field_key: "genre_head", label: "Genre Head", field_type: "text", vfh_only: true },

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
  { module: "operations", section: "Financials", field_key: "costing_email", label: "Costing Email", field_type: "dropdown", options: ["Pending", "Sent", "Approved"], default_value: "Pending" },
  { module: "operations", section: "Financials", field_key: "proforma_invoice", label: "Proforma Invoice", field_type: "dropdown", options: ["Pending", "Sent", "Approved"], default_value: "Pending" },
  { module: "operations", section: "Financials", field_key: "installment_1_expected_date", label: "Installment 1 — Expected Date", field_type: "date", triggers_task: { rule: "instalment", title: "Follow up: Installment 1", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_2_expected_date", label: "Installment 2 — Expected Date", field_type: "date", triggers_task: { rule: "instalment", title: "Follow up: Installment 2", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_3_expected_date", label: "Installment 3 — Expected Date", field_type: "date", triggers_task: { rule: "instalment", title: "Follow up: Installment 3", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_4_expected_date", label: "Installment 4 — Expected Date", field_type: "date", triggers_task: { rule: "instalment", title: "Follow up: Installment 4", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "installment_5_expected_date", label: "Installment 5 — Expected Date", field_type: "date", triggers_task: { rule: "instalment", title: "Follow up: Installment 5", due_after_days: 0, complete_when: "payment is received" } },
  { module: "operations", section: "Financials", field_key: "full_payment_received", label: "Full Payment Received", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },

  // 7. CONFIRMATION LETTER
  { module: "operations", section: "Confirmation Letter", field_key: "confirmation_made", label: "Made", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  { module: "operations", section: "Confirmation Letter", field_key: "confirmation_couriered", label: "Couriered", field_type: "date", triggers_task: { rule: "confirmation_letter", title: "Follow up on Confirmation Letter", due_after_days: 3, complete_when: "signed confirmation is received" } },
  { module: "operations", section: "Confirmation Letter", field_key: "confirmation_signed_received", label: "Signed Copy Received", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },

  // 8. ADDITIONAL REQUIREMENTS
  { module: "operations", section: "Additional Requirements", field_key: "req_sound", label: "Sound", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required" },
  { module: "operations", section: "Additional Requirements", field_key: "req_piano", label: "Piano", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required" },
  { module: "operations", section: "Additional Requirements", field_key: "req_liquor_license", label: "Liquor License", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required" },
  { module: "operations", section: "Additional Requirements", field_key: "req_orchestra_pit_chairs", label: "Orchestra Pit Chairs", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required" },
  { module: "operations", section: "Additional Requirements", field_key: "req_digital_standee", label: "Digital Standee", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required" },
  { module: "operations", section: "Additional Requirements", field_key: "req_car_display", label: "Car Display", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required" },
  { module: "operations", section: "Additional Requirements", field_key: "req_bike_display", label: "Bike Display", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required" },
  { module: "operations", section: "Additional Requirements", field_key: "req_stalls", label: "Stalls", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required" },
  { module: "operations", section: "Additional Requirements", field_key: "req_telecasting_media", label: "Telecasting / Media", field_type: "dropdown", options: ["Not Required", "Required"], default_value: "Not Required" },

  // 9. NOC
  { module: "operations", section: "NOC", field_key: "noc_sent_on", label: "NOC Sent On", field_type: "date" },
  { module: "operations", section: "NOC", field_key: "noc_status", label: "NOC Status", field_type: "computed", is_computed: true, default_value: "Not Sent" },

  // 10. ONSTAGE (sequential pipeline)
  { module: "operations", section: "OnStage", field_key: "onstage_asked_client", label: "OnStage — Asked Client", field_type: "date", triggers_task: { rule: "onstage", title: "Follow up for OnStage information", due_after_days: 3, complete_when: "marked Received" } },
  { module: "operations", section: "OnStage", field_key: "onstage_received_from_client", label: "OnStage — Received from Client", field_type: "date" },
  { module: "operations", section: "OnStage", field_key: "onstage_sent_to_team", label: "OnStage — Sent to Team", field_type: "date" },
  { module: "operations", section: "OnStage", field_key: "onstage_verified", label: "OnStage — Verified", field_type: "date" },
  { module: "operations", section: "OnStage", field_key: "onstage_complete", label: "OnStage — Complete", field_type: "date" },

  // 11. TECHNICAL MEETING & MINUTES
  { module: "operations", section: "Technical Meeting & Minutes", field_key: "technical_meeting_date", label: "Technical Meeting Date", field_type: "date", triggers_task: { rule: "technical_meeting", title: "Technical Meeting", due_after_days: 0, complete_when: "the meeting date passes" } },
  { module: "operations", section: "Technical Meeting & Minutes", field_key: "minutes_of_meeting", label: "Minutes of Meeting", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },

  // 12. OPERATIONS DETAILS
  { module: "operations", section: "Operations Details", field_key: "no_of_crew_cards", label: "No. of Crew Cards", field_type: "number" },
  { module: "operations", section: "Operations Details", field_key: "house_seats", label: "House Seats", field_type: "number" },
  { module: "operations", section: "Operations Details", field_key: "licenses", label: "Licenses", field_type: "textarea" },
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

  // 14. EVENT STATUS
  { module: "operations", section: "Event Status", field_key: "event_status", label: "Event Status", field_type: "dropdown", options: ["Tentative", "Confirmed", "Regret"], default_value: "Tentative" },

  // ===== ACCOUNTS TRACKING CHECKLIST (3 sections) =====
  // Note: 3-day notification rule on file_sent_to_accounts.

  // A1. FILE TRACKING
  { module: "accounts", section: "File Tracking", field_key: "file_sent_to_accounts", label: "File Sent to Accounts — Date", field_type: "date", triggers_task: { rule: "accounts_file", title: "Follow up with Accounts", due_after_days: 3, complete_when: "Final File is Received" } },
  { module: "accounts", section: "File Tracking", field_key: "notify_after_3_days", label: "Notify After 3 Days?", field_type: "computed", is_computed: true, default_value: "Yes" },
  { module: "accounts", section: "File Tracking", field_key: "file_received_back_edit_1", label: "File Received Back — Edit 1", field_type: "dropdown", options: ["Pending", "Received"], default_value: "Pending" },
  { module: "accounts", section: "File Tracking", field_key: "file_received_back_edit_2", label: "File Received Back — Edit 2", field_type: "dropdown", options: ["Pending", "Received"], default_value: "Pending" },
  { module: "accounts", section: "File Tracking", field_key: "final_file_received", label: "Final File Received", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },

  // A2. PAYMENT & REFUND TRACKING
  { module: "accounts", section: "Payment & Refund", field_key: "security_deposit_refund", label: "Security Deposit Refund", field_type: "dropdown", options: ["N/A", "Applicable"], default_value: "N/A" },
  { module: "accounts", section: "Payment & Refund", field_key: "box_office_collection_refund", label: "Box Office Collection Refund", field_type: "dropdown", options: ["N/A", "Applicable"], default_value: "N/A" },
  { module: "accounts", section: "Payment & Refund", field_key: "payment_advice", label: "Payment Advice", field_type: "dropdown", options: ["Awaiting", "Received"], default_value: "Awaiting" },
  { module: "accounts", section: "Payment & Refund", field_key: "tds_certificate_sent_to_client", label: "TDS Certificate — Sent to Client?", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  { module: "accounts", section: "Payment & Refund", field_key: "tds_certificate_refund_and_payment_advice", label: "TDS Certificate Refund & Payment Advice", field_type: "dropdown", options: ["Awaiting", "Received"], default_value: "Awaiting" },
  { module: "accounts", section: "Payment & Refund", field_key: "payment_ledger", label: "Payment Ledger", field_type: "dropdown", options: ["Requested", "Received"], default_value: "Requested" },

  // B. TO CLIENT (outbound documents)
  { module: "accounts", section: "To Client", field_key: "tax_invoice_sent", label: "Tax Invoice — Sent?", field_type: "dropdown", options: ["Not Sent", "Sent"], default_value: "Not Sent" },
  { module: "accounts", section: "To Client", field_key: "box_office_statement_sent", label: "Box Office Statement — Sent?", field_type: "dropdown", options: ["Not Sent", "Sent"], default_value: "Not Sent" },
  { module: "accounts", section: "To Client", field_key: "payment_advice_received_from_client", label: "Payment Advice — Received from Client?", field_type: "dropdown", options: ["No", "Yes"], default_value: "No" },
  { module: "accounts", section: "To Client", field_key: "tds_certificate_from_client", label: "TDS Certificate — From Client", field_type: "dropdown", options: ["N.A.", "Awaiting", "Received"], default_value: "N.A." },
  { module: "accounts", section: "To Client", field_key: "tds_payment_and_advice_sent", label: "TDS Payment & Advice — Sent?", field_type: "dropdown", options: ["Awaiting", "Sent"], default_value: "Awaiting" },
  { module: "accounts", section: "To Client", field_key: "payment_ledger_sent", label: "Payment Ledger — Sent?", field_type: "dropdown", options: ["Requested", "Sent"], default_value: "Requested" },

  // C. ACCOUNTS STATUS SUMMARY (computed, read-only)
  { module: "accounts", section: "Accounts Status Summary", field_key: "accounts_file_status", label: "Accounts File Status", field_type: "computed", is_computed: true, default_value: "Open" },
  { module: "accounts", section: "Accounts Status Summary", field_key: "outstanding_to_client", label: "Outstanding to Client", field_type: "computed", is_computed: true, default_value: "—" },
  { module: "accounts", section: "Accounts Status Summary", field_key: "notifications_triggered", label: "Notifications Triggered", field_type: "computed", is_computed: true, default_value: "0" },
];
