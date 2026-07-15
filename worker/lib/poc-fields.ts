/** POC fields that must be filled before an event can move to confirmation. */
export const POC_REQUIRED_FIELD_KEYS = [
  "poc_name",
  "poc_contact_number",
  "poc_email",
  "bank_details",
  "signing_authority_address",
] as const;

export type PocRequiredFieldKey = (typeof POC_REQUIRED_FIELD_KEYS)[number];

export const POC_ORGANISATION_LABEL = "Organisation";

/** Point of Contact checklist keys mirrored on the add/edit event form. */
export const POC_FIELD_KEYS = [
  "poc_name",
  "poc_contact_number",
  "poc_email",
  "event_company_contact_name",
  "event_company_contact_number",
  "event_company_email",
  "bank_details",
  "gst_no",
  "tan_no",
  "pan_no",
  "signing_authority_address",
  "courier_address",
  "vendor_registration_form",
] as const;

export type PocFieldKey = (typeof POC_FIELD_KEYS)[number];

export const POC_FIELD_LABELS: Record<PocFieldKey, string> = {
  poc_name: "POC Name",
  poc_contact_number: "Contact Number",
  poc_email: "Email",
  event_company_contact_name: "Event Company Contact Name",
  event_company_contact_number: "Event Company Contact Number",
  event_company_email: "Event Company Email",
  bank_details: "Bank Details",
  gst_no: "GST No.",
  tan_no: "TAN No.",
  pan_no: "PAN No.",
  signing_authority_address: "Signing Authority & Address",
  courier_address: "Courier Address",
  vendor_registration_form: "Vendor Registration Form",
};

export const VENDOR_REGISTRATION_OPTIONS = ["Pending", "Received", "No Applicable"] as const;
