import { describe, expect, it } from "vitest";
import {
  evaluatePocCompletion,
  getPocFieldValuesForEvents,
  isEventCompanyRequired,
  isPocFieldValueFilled,
  listEventsWithIncompletePoc,
  mergePocValues,
  POC_CONFIRMATION_BLOCKER,
} from "../../worker/lib/poc-completion";

describe("poc completion", () => {
  it("batches large dashboard enrichments below the D1 parameter limit", async () => {
    const bindSizes: number[] = [];
    const db = {
      prepare() {
        return {
          bind(...values: unknown[]) { bindSizes.push(values.length); return this; },
          async all() { return { results: [] }; },
        };
      },
    } as unknown as D1Database;

    const eventIds = Array.from({ length: 230 }, (_, index) => `ev_${index}`);
    const values = await getPocFieldValuesForEvents(db, eventIds);

    expect(Math.max(...bindSizes)).toBeLessThanOrEqual(100);
    expect(bindSizes.length).toBe(8);
    expect(values.size).toBe(eventIds.length);
  });

  it("treats vendor registration Pending as incomplete", () => {
    expect(isPocFieldValueFilled("vendor_registration_form", "Pending")).toBe(false);
    expect(isPocFieldValueFilled("vendor_registration_form", "Received")).toBe(true);
    expect(isPocFieldValueFilled("vendor_registration_form", "No Applicable")).toBe(true);
  });

  it("requires only confirmation-critical POC fields before marking complete", () => {
    const partial = evaluatePocCompletion({
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
    });
    expect(partial.complete).toBe(false);
    expect(partial.filledCount).toBe(3);
    expect(partial.totalCount).toBe(5);
    expect(partial.missing).toContain("bank_details");
    expect(partial.missing).not.toContain("event_company_contact_name");
  });

  it("marks complete when required POC fields are filled", () => {
    const complete = evaluatePocCompletion({
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
      bank_details: "ICICI Bank",
      signing_authority_address: "Principal",
    });
    expect(complete.complete).toBe(true);
    expect(complete.missing).toEqual([]);
    expect(complete.totalCount).toBe(5);
  });

  it("requires organisation when confirmation readiness is evaluated", () => {
    const values = {
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
      bank_details: "ICICI Bank",
      signing_authority_address: "Principal",
    };
    expect(evaluatePocCompletion(values, { organisationId: null }).complete).toBe(false);
    expect(evaluatePocCompletion(values, { organisationId: "org_1" }).complete).toBe(true);
    expect(evaluatePocCompletion(values, { organisationId: null }).missingLabels).toContain("Organisation");
  });

  it("allows optional POC fields to remain empty", () => {
    const complete = evaluatePocCompletion({
      event_company_required: "N/A",
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
      bank_details: "ICICI Bank",
      signing_authority_address: "Principal",
      event_company_contact_name: "",
      gst_no: "",
      vendor_registration_form: "Pending",
    });
    expect(complete.complete).toBe(true);
  });

  it("requires event company fields only when Event Company is Yes", () => {
    const missing = evaluatePocCompletion({
      event_company_required: "Yes",
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
      bank_details: "ICICI Bank",
      signing_authority_address: "Principal",
    });
    expect(missing.complete).toBe(false);
    expect(missing.missingLabels).toContain("Event Company Name");
    expect(missing.totalCount).toBe(9);

    const complete = evaluatePocCompletion({
      event_company_required: "Yes",
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
      bank_details: "ICICI Bank",
      signing_authority_address: "Principal",
      event_company_name: "Event Co",
      event_company_contact_name: "Ravi Shah",
      event_company_contact_number: "9820000000",
      event_company_email: "ravi@eventco.example",
    });
    expect(complete.complete).toBe(true);
  });

  it("infers Event Company = Yes for legacy rows with company data but no toggle", () => {
    expect(isEventCompanyRequired({ event_company_name: "Event Co" })).toBe(true);
    expect(isEventCompanyRequired({ event_company_required: "N/A", event_company_name: "Event Co" })).toBe(false);
  });

  it("still marks complete when all POC fields are filled", () => {
    const complete = evaluatePocCompletion({
      event_company_required: "Yes",
      poc_name: "Karina Arora",
      poc_contact_number: "9833205630",
      poc_email: "karina.arora@cathedral-school.com",
      event_company_name: "Event Co",
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
                  { event_id: "ev_full", event_title: "Full POC", organisation_name: "Acme", organisation_id: "org_full", event_start_date: "2026-08-01", status: "tentative" },
                  { event_id: "ev_gap", event_title: "Gap POC", organisation_name: "Beta", organisation_id: "org_gap", event_start_date: "2026-08-02", status: "approved" },
                ],
              };
            }
            if (sql.includes("FROM checklist_items") && sql.includes("event_id IN")) {
              return {
                results: [
                  { event_id: "ev_full", field_key: "poc_name", value: "A" },
                  { event_id: "ev_full", field_key: "poc_contact_number", value: "1" },
                  { event_id: "ev_full", field_key: "poc_email", value: "a@b.c" },
                  { event_id: "ev_full", field_key: "bank_details", value: "bank" },
                  { event_id: "ev_full", field_key: "signing_authority_address", value: "addr" },
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
    expect(rows[0]?.filled_count).toBe(2);
    expect(rows[0]?.missing_labels.length).toBeGreaterThan(0);
  });
});
