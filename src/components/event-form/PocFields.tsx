import clsx from "clsx";
import { VENDOR_REGISTRATION_OPTIONS } from "../../../worker/lib/poc-fields";
import { evaluatePocCompletion } from "../../../worker/lib/poc-completion";
import { withDefaultEventLevelRequirements } from "../../lib/event-edit-form";

type PocValue = Record<string, unknown>;

type PocFieldsProps = {
  value: PocValue;
  onChange: (next: PocValue) => void;
};

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-sage etched">{label}</span>
      {children}
    </label>
  );
}

/** Event-level Point of Contact fields — the event form is the source of truth. */
export function PocFields({ value, onChange }: PocFieldsProps) {
  const reqs = withDefaultEventLevelRequirements(value);
  const setReq = (key: string, nextValue: unknown) => onChange({ ...reqs, [key]: nextValue });
  const poc = evaluatePocCompletion(reqs);

  return (
    <section id="requirement-poc" className="carved-card scroll-mt-6 rounded-2xl bg-marble-highlight/50 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Point of Contact</h3>
      {!poc.complete && (
        <div role="alert" className="mb-4 rounded-xl border border-status-awaitingApproval/35 bg-status-awaitingApproval/12 px-4 py-3 text-xs text-ink-secondary etched">
          <span className="font-semibold text-status-awaitingApproval etched-deep">
            Point of Contact incomplete ({poc.filledCount}/{poc.totalCount})
          </span>
          {poc.missingLabels.length > 0 && (
            <span className="mt-1 block">
              Still needed: {poc.missingLabels.join(", ")}. Required fields must be complete before confirmation.
            </span>
          )}
        </div>
      )}
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted etched">Organisation</h4>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="POC Name">
          <input id="requirement-field-poc_name" type="text" value={(reqs.poc_name as string) ?? ""} onChange={(e) => setReq("poc_name", e.target.value || null)} className="carved input" />
        </Field>
        <Field label="Contact Number">
          <input id="requirement-field-poc_contact_number" type="tel" value={(reqs.poc_contact_number as string) ?? ""} onChange={(e) => setReq("poc_contact_number", e.target.value || null)} className="carved input" />
        </Field>
        <Field label="Email" className="md:col-span-2">
          <input id="requirement-field-poc_email" type="email" value={(reqs.poc_email as string) ?? ""} onChange={(e) => setReq("poc_email", e.target.value || null)} className="carved input" />
        </Field>
        <Field label="GST No.">
          <input id="requirement-field-gst_no" type="text" value={(reqs.gst_no as string) ?? ""} onChange={(e) => setReq("gst_no", e.target.value || null)} className="carved input" />
        </Field>
        <Field label="PAN No.">
          <input id="requirement-field-pan_no" type="text" value={(reqs.pan_no as string) ?? ""} onChange={(e) => setReq("pan_no", e.target.value || null)} className="carved input" />
        </Field>
        <Field label="TAN No.">
          <input id="requirement-field-tan_no" type="text" value={(reqs.tan_no as string) ?? ""} onChange={(e) => setReq("tan_no", e.target.value || null)} className="carved input" />
        </Field>
        <Field label="Vendor Registration">
          <select id="requirement-field-vendor_registration_form" value={(reqs.vendor_registration_form as string) ?? ""} onChange={(e) => setReq("vendor_registration_form", e.target.value || null)} className="carved input">
            <option value="">Select…</option>
            {VENDOR_REGISTRATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </Field>
        <Field label="Bank Details" className="md:col-span-2">
          <textarea id="requirement-field-bank_details" value={(reqs.bank_details as string) ?? ""} onChange={(e) => setReq("bank_details", e.target.value || null)} className="carved input" rows={3} />
        </Field>
        <Field label="Signing Authority">
          <textarea id="requirement-field-signing_authority_address" value={(reqs.signing_authority_address as string) ?? ""} onChange={(e) => setReq("signing_authority_address", e.target.value || null)} className="carved input" rows={3} />
        </Field>
        <Field label="Courier Address">
          <textarea id="requirement-field-courier_address" value={(reqs.courier_address as string) ?? ""} onChange={(e) => setReq("courier_address", e.target.value || null)} className="carved input" rows={3} />
        </Field>
      </div>
      <h4 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-ink-muted etched">Event Company</h4>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Company Name" className="md:col-span-2">
          <input id="requirement-field-event_company_name" type="text" value={(reqs.event_company_name as string) ?? ""} onChange={(e) => setReq("event_company_name", e.target.value || null)} className="carved input" />
        </Field>
        <Field label="Point of Contact Name">
          <input id="requirement-field-event_company_contact_name" type="text" value={(reqs.event_company_contact_name as string) ?? ""} onChange={(e) => setReq("event_company_contact_name", e.target.value || null)} className="carved input" />
        </Field>
        <Field label="Contact Number">
          <input id="requirement-field-event_company_contact_number" type="tel" value={(reqs.event_company_contact_number as string) ?? ""} onChange={(e) => setReq("event_company_contact_number", e.target.value || null)} className="carved input" />
        </Field>
        <Field label="Email" className="md:col-span-2">
          <input id="requirement-field-event_company_email" type="email" value={(reqs.event_company_email as string) ?? ""} onChange={(e) => setReq("event_company_email", e.target.value || null)} className="carved input" />
        </Field>
      </div>
    </section>
  );
}
