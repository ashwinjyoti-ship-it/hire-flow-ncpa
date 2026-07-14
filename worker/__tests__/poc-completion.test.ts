import { describe, expect, it } from "vitest";
import {
  evaluatePocCompletion,
  isPocFieldValueFilled,
  listEventsWithIncompletePoc,
  mergePocValues,
  POC_CONFIRMATION_BLOCKER,
} from "../../worker/lib/poc-completion";

describe("poc completion", () => {
  it("treats vendor registration Pending as incomplete", () => {
    expect(isPocFieldValueFilled("vendor_registration_form", "Pending")).toBe(false);
    expect(isPocFieldValueFilled("vendor_registration_form", "Received")).toBe(true);
    expect(isPocFieldValueFilled("vendor_registration_form", "No Applicable")).toBe(true);
  });

  it("requires all thirteen fields before marking complete", () => {
    const partial = evaluatePocCompletion({
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
    });
    expect(partial.complete).toBe(false);
    expect(partial.filledCount).toBe(3);
    expect(partial.missing).toContain("bank_details");
    expect(partial.missing).toContain("event_company_contact_name");
  });

  it("marks complete only when every field is filled", () => {
    const complete = evaluatePocCompletion({
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
      event_company_contact_name: "Ravi Shah",
      event_company_contact_number: "9820000000",
      event_company_email: "ravi@eventco.example",
      bank_details: "ICICI Bank",
      gst_no: "27AAATT3454F1ZI",
      tan_no: "TAN123",
      pan_no: "PAN123",
      signing_authority_address: "Principal",
      courier_address: "Mumbai",
      vendor_registration_form: "No Applicable",
    });
    expect(complete.complete).toBe(true);
    expect(complete.missing).toEqual([]);
  });

  it("merges checklist values with requirements fallback", () => {
    expect(mergePocValues(
      { poc_name: "From checklist" },
      JSON.stringify({ poc_email: "from-form@example.com" }),
    )).toEqual({
      poc_name: "From checklist",
      poc_email: "from-form@example.com",
    });
  });

  it("uses the confirmation blocker copy requested by ops", () => {
    expect(POC_CONFIRMATION_BLOCKER).toBe("POC not filled, cannot confirm.");
  });

  it("lists active pipeline events with incomplete POC for briefs", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() { return this; },
          async all() {
            if (sql.includes("FROM events e") && sql.includes("e.status IN")) {
              return {
                results: [
                  { event_id: "ev_full", event_title: "Full POC", organisation_name: "Acme", event_start_date: "2026-08-01", status: "tentative" },
                  { event_id: "ev_gap", event_title: "Gap POC", organisation_name: "Beta", event_start_date: "2026-08-02", status: "approved" },
                ],
              };
            }
            if (sql.includes("FROM checklist_items") && sql.includes("event_id IN")) {
              return {
                results: [
                  { event_id: "ev_full", field_key: "poc_name", value: "A" },
                  { event_id: "ev_full", field_key: "poc_contact_number", value: "1" },
                  { event_id: "ev_full", field_key: "poc_email", value: "a@b.c" },
                  { event_id: "ev_full", field_key: "event_company_contact_name", value: "Org" },
                  { event_id: "ev_full", field_key: "event_company_contact_number", value: "2" },
                  { event_id: "ev_full", field_key: "event_company_email", value: "org@b.c" },
                  { event_id: "ev_full", field_key: "bank_details", value: "bank" },
                  { event_id: "ev_full", field_key: "gst_no", value: "gst" },
                  { event_id: "ev_full", field_key: "tan_no", value: "tan" },
                  { event_id: "ev_full", field_key: "pan_no", value: "pan" },
                  { event_id: "ev_full", field_key: "signing_authority_address", value: "addr" },
                  { event_id: "ev_full", field_key: "courier_address", value: "courier" },
                  { event_id: "ev_full", field_key: "vendor_registration_form", value: "Received" },
                  { event_id: "ev_gap", field_key: "poc_name", value: "Only name" },
                ],
              };
            }
            if (sql.includes("SELECT id, requirements FROM events WHERE id IN")) {
              return { results: [{ id: "ev_full", requirements: null }, { id: "ev_gap", requirements: null }] };
            }
            return { results: [] };
          },
        };
      },
    } as unknown as D1Database;

    const rows = await listEventsWithIncompletePoc(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_id).toBe("ev_gap");
    expect(rows[0]?.filled_count).toBe(1);
    expect(rows[0]?.missing_labels.length).toBeGreaterThan(0);
  });
});
