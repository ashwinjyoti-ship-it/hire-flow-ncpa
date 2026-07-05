/**
 * Seed reference data extracted verbatim from the supplied workbooks.
 * Sources:
 *   - Executive Event Tracker with Charts 2.xlsx → Dropdown_Master
 *   - Event Operations Accounts Forms v2.1.xlsx → dropdowns + Agent Guide
 *   - NCPA Event Form Mockup V1.xlsx → event form fields
 *
 * This is the single source of truth for lookup lists and checklist templates.
 * Admins can extend these via the Settings UI; seeding is repeatable (upsert by
 * list_key+value / module+field_key) and never deletes existing options.
 */

export interface DropdownSeed {
  list_key: string;
  value: string;
  sort_order: number;
  /** Optional metadata, e.g. venue combos { parts: ["JBT","OAP"] }. */
  metadata?: Record<string, unknown>;
}

/** All venues, including single venues and combined-venue combos from Dropdown_Master. */
export const VENUES: DropdownSeed[] = [
  // Single venues (canonical codes; full names mapped where used in the form)
  { list_key: "venue", value: "JBT", sort_order: 1 },
  { list_key: "venue", value: "TATA", sort_order: 2, metadata: { also: "TT" } },
  { list_key: "venue", value: "TET", sort_order: 3 },
  { list_key: "venue", value: "GDT", sort_order: 4 },
  { list_key: "venue", value: "LT", sort_order: 5 },
  { list_key: "venue", value: "OAP", sort_order: 6 },
  { list_key: "venue", value: "JBT Box", sort_order: 7 },
  { list_key: "venue", value: "TATA Garden", sort_order: 8, metadata: { also: "TTGDN" } },
  { list_key: "venue", value: "TET Garden", sort_order: 9, metadata: { also: "TETGDN" } },
  { list_key: "venue", value: "Sunken Garden", sort_order: 10 },
  { list_key: "venue", value: "West Room 1", sort_order: 11 },
  { list_key: "venue", value: "SVR", sort_order: 12 },
  // Combined-venue combos (stored as single dropdown options per Dropdown_Master)
  { list_key: "venue", value: "TET & GDT", sort_order: 20, metadata: { parts: ["TET", "GDT"], combo: true } },
  { list_key: "venue", value: "JBT & OAP", sort_order: 21, metadata: { parts: ["JBT", "OAP"], combo: true } },
  { list_key: "venue", value: "TATA & OAP", sort_order: 22, metadata: { parts: ["TATA", "OAP"], combo: true, also: "TT & OAP" } },
  { list_key: "venue", value: "TATA & TATA Garden", sort_order: 23, metadata: { parts: ["TATA", "TATA Garden"], combo: true, also: "TT & TTGDN" } },
  { list_key: "venue", value: "TET & OAP", sort_order: 24, metadata: { parts: ["TET", "OAP"], combo: true } },
  { list_key: "venue", value: "TET & TET Garden", sort_order: 25, metadata: { parts: ["TET", "TET Garden"], combo: true, also: "TET & TETGDN" } },
  { list_key: "venue", value: "GDT & OAP", sort_order: 26, metadata: { parts: ["GDT", "OAP"], combo: true } },
  { list_key: "venue", value: "GDT & Sunken Garden", sort_order: 27, metadata: { parts: ["GDT", "Sunken Garden"], combo: true, also: "GDT & Sunken" } },
  { list_key: "venue", value: "LT & OAP", sort_order: 28, metadata: { parts: ["LT", "OAP"], combo: true } },
  { list_key: "venue", value: "LT & TET Garden", sort_order: 29, metadata: { parts: ["LT", "TET Garden"], combo: true, also: "LT & TETGDN" } },
  { list_key: "venue", value: "LT & Sunken Garden", sort_order: 30, metadata: { parts: ["LT", "Sunken Garden"], combo: true, also: "LT & Sunken" } },
];

export const DROPDOWN_LISTS: DropdownSeed[] = [
  // Event type (VFH approval gated on this)
  { list_key: "event_type", value: "EE", sort_order: 1 },
  { list_key: "event_type", value: "FR", sort_order: 2, metadata: { full: "Foundation" } },
  { list_key: "event_type", value: "VFH", sort_order: 3, metadata: { full: "Venue For Hire", requires_approval: true } },
  { list_key: "event_type", value: "Free Event", sort_order: 4, metadata: { also: "FE" } },

  // Event status — canonical lifecycle (6 statuses).
  //   enquiry → tentative → approved (VFH only) → confirmed
  //   regret = declined enquiry (terminal)
  //   cancelled = booking called off (terminal)
  { list_key: "event_status", value: "enquiry", sort_order: 1 },
  { list_key: "event_status", value: "tentative", sort_order: 2 },
  { list_key: "event_status", value: "approved", sort_order: 3, metadata: { vfh_only: true } },
  { list_key: "event_status", value: "confirmed", sort_order: 4 },
  { list_key: "event_status", value: "regret", sort_order: 5, metadata: { terminal: true } },
  { list_key: "event_status", value: "cancelled", sort_order: 6, metadata: { terminal: true } },

  // Staff: Program Officer (Dropdown_Master ProgramOfficer)
  { list_key: "program_officer", value: "Farha", sort_order: 1 },
  { list_key: "program_officer", value: "Nasha", sort_order: 2 },
  { list_key: "program_officer", value: "Delzeen", sort_order: 3 },
  { list_key: "program_officer", value: "Binaifar", sort_order: 4 },
  { list_key: "program_officer", value: "Sangeeta", sort_order: 5 },
  { list_key: "program_officer", value: "Adil", sort_order: 6 },

  // Staff: Handled By / Event Owner (Dropdown_Master Handled By)
  { list_key: "handled_by", value: "Farha", sort_order: 1 },
  { list_key: "handled_by", value: "Nasha", sort_order: 2 },
  { list_key: "handled_by", value: "Delzeen", sort_order: 3 },
  { list_key: "handled_by", value: "Adil", sort_order: 4 },

  // Approval: sent by (Dropdown_Master SentForApprovalBy)
  { list_key: "approval_sent_by", value: "Nooshin", sort_order: 1 },
  { list_key: "approval_sent_by", value: "Farha", sort_order: 2 },
  { list_key: "approval_sent_by", value: "Nasha", sort_order: 3 },
  { list_key: "approval_sent_by", value: "Delzeen", sort_order: 4 },

  // Approval: sent to / Genre Heads (Dropdown_Master ApprovalSentTo)
  { list_key: "approval_sent_to", value: "Bruce", sort_order: 1 },
  { list_key: "approval_sent_to", value: "Dr. Rao", sort_order: 2 },
  { list_key: "approval_sent_to", value: "Farrahnaz Irani", sort_order: 3 },
  { list_key: "approval_sent_to", value: "Swapno", sort_order: 4 },
  { list_key: "approval_sent_to", value: "Bianca", sort_order: 5 },
  { list_key: "approval_sent_to", value: "Nandita", sort_order: 6 },
  { list_key: "approval_sent_to", value: "Nooshin", sort_order: 7 },

  // Caterer (Dropdown_Master Caterer)
  { list_key: "caterer", value: "Bay 21", sort_order: 1 },
  { list_key: "caterer", value: "Taj President", sort_order: 2 },
  { list_key: "caterer", value: "Gourmet Catering", sort_order: 3 },
  { list_key: "caterer", value: "Fountain Hospitality Pvt. Ltd.", sort_order: 4 },
  { list_key: "caterer", value: "Popular Caterers", sort_order: 5 },
  { list_key: "caterer", value: "Om Ganesha Caterers", sort_order: 6 },
  { list_key: "caterer", value: "Kapco Banquets and Catering Pvt. Ltd.", sort_order: 7 },
  { list_key: "caterer", value: "NCPA Canteen", sort_order: 8 },

  // Decorator (Dropdown_Master Decorator)
  { list_key: "decorator", value: "Tanna Enterprises", sort_order: 1 },
  { list_key: "decorator", value: "Bageecha", sort_order: 2 },
  { list_key: "decorator", value: "Dayasheel Decorators", sort_order: 3 },
  { list_key: "decorator", value: "Rentastic Wedding and Events LLP", sort_order: 4 },

  // Enquiry Source (Dropdown_Master EnquirySource)
  { list_key: "enquiry_source", value: "Referral", sort_order: 1 },
  { list_key: "enquiry_source", value: "Website", sort_order: 2 },
  { list_key: "enquiry_source", value: "Repeat Client", sort_order: 3 },
  { list_key: "enquiry_source", value: "Walk-in", sort_order: 4 },
  { list_key: "enquiry_source", value: "Phone Call", sort_order: 5 },
  { list_key: "enquiry_source", value: "Email", sort_order: 6 },

  // Repeat Client
  { list_key: "repeat_client", value: "Yes", sort_order: 1 },
  { list_key: "repeat_client", value: "No", sort_order: 2 },

  // Priority (Dropdown_Master Priority)
  { list_key: "priority", value: "High", sort_order: 1 },
  { list_key: "priority", value: "Medium", sort_order: 2 },
  { list_key: "priority", value: "Low", sort_order: 3 },

  // Contracts (Dropdown_Master Contracts)
  { list_key: "contracts", value: "Made", sort_order: 1 },
  { list_key: "contracts", value: "Sent", sort_order: 2 },
  { list_key: "contracts", value: "Received", sort_order: 3 },

  // Vendor Registration Form
  { list_key: "vendor_registration", value: "Pending", sort_order: 1 },
  { list_key: "vendor_registration", value: "Received", sort_order: 2 },

  // Catering tier
  { list_key: "tier", value: "A", sort_order: 1 },
  { list_key: "tier", value: "B", sort_order: 2 },
  { list_key: "tier", value: "C", sort_order: 3 },
  { list_key: "tier", value: "D", sort_order: 4 },
  { list_key: "tier", value: "E", sort_order: 5 },

  // Type of catering
  { list_key: "catering_type", value: "Veg", sort_order: 1 },
  { list_key: "catering_type", value: "Non-Veg", sort_order: 2 },
  { list_key: "catering_type", value: "Veg & Non-Veg", sort_order: 3 },
  { list_key: "catering_type", value: "Tea/Coffee", sort_order: 4 },
  { list_key: "catering_type", value: "Snacks", sort_order: 5 },
  { list_key: "catering_type", value: "Custom", sort_order: 6 },

  // Approval required
  { list_key: "approval_required", value: "Not Required", sort_order: 1 },
  { list_key: "approval_required", value: "Required", sort_order: 2 },

  // Generic status triplets used by checklist items
  { list_key: "status_pending_sent_approved", value: "Pending", sort_order: 1 },
  { list_key: "status_pending_sent_approved", value: "Sent", sort_order: 2 },
  { list_key: "status_pending_sent_approved", value: "Approved", sort_order: 3 },

  { list_key: "status_no_yes", value: "No", sort_order: 1 },
  { list_key: "status_no_yes", value: "Yes", sort_order: 2 },

  { list_key: "status_not_required_required", value: "Not Required", sort_order: 1 },
  { list_key: "status_not_required_required", value: "Required", sort_order: 2 },

  { list_key: "status_not_sent_sent", value: "Not Sent", sort_order: 1 },
  { list_key: "status_not_sent_sent", value: "Sent", sort_order: 2 },

  { list_key: "status_na_applicable", value: "N/A", sort_order: 1 },
  { list_key: "status_na_applicable", value: "Applicable", sort_order: 2 },

  { list_key: "status_awaiting_received", value: "Awaiting", sort_order: 1 },
  { list_key: "status_awaiting_received", value: "Received", sort_order: 2 },

  { list_key: "status_requested_received", value: "Requested", sort_order: 1 },
  { list_key: "status_requested_received", value: "Received", sort_order: 2 },

  { list_key: "status_not_ready_ready", value: "Not Ready", sort_order: 1 },
  { list_key: "status_not_ready_ready", value: "Ready", sort_order: 2 },

  { list_key: "status_not_sent_sent_na", value: "N.A.", sort_order: 1 },
  { list_key: "status_not_sent_sent_na", value: "Not Sent", sort_order: 2 },
  { list_key: "status_not_sent_sent_na", value: "Sent", sort_order: 3 },

  { list_key: "status_pending_received", value: "Pending", sort_order: 1 },
  { list_key: "status_pending_received", value: "Received", sort_order: 2 },

  // Months
  { list_key: "month", value: "January", sort_order: 1 },
  { list_key: "month", value: "February", sort_order: 2 },
  { list_key: "month", value: "March", sort_order: 3 },
  { list_key: "month", value: "April", sort_order: 4 },
  { list_key: "month", value: "May", sort_order: 5 },
  { list_key: "month", value: "June", sort_order: 6 },
  { list_key: "month", value: "July", sort_order: 7 },
  { list_key: "month", value: "August", sort_order: 8 },
  { list_key: "month", value: "September", sort_order: 9 },
  { list_key: "month", value: "October", sort_order: 10 },
  { list_key: "month", value: "November", sort_order: 11 },
  { list_key: "month", value: "December", sort_order: 12 },
];

export const ALL_DROPDOWNS: DropdownSeed[] = [...VENUES, ...DROPDOWN_LISTS];
