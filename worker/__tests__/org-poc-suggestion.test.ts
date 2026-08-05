import { describe, expect, it } from "vitest";
import { getOrgPocSuggestion } from "../lib/org-poc-suggestion";

type QueryHandler = {
  first?: () => unknown;
  all?: () => unknown;
};

function fakeDb(handlerFor: (sql: string) => QueryHandler): D1Database {
  return {
    prepare(sql: string) {
      const handler = handlerFor(sql);
      return {
        bind() {
          return this;
        },
        async first() {
          return handler.first?.() ?? null;
        },
        async all() {
          return handler.all?.() ?? { results: [] };
        },
      };
    },
  } as unknown as D1Database;
}

describe("getOrgPocSuggestion", () => {
  it("returns the latest event POC for an organisation name group", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM organisations WHERE id = ? AND is_archived = 0")) {
        return {
          first: () => ({
            id: "org_a",
            name: "Symphony Orchestra",
            gst_number: null,
            pan_number: null,
            tan_number: null,
            bank_details: null,
          }),
        };
      }
      if (sql.includes("FROM events e")) {
        return {
          all: () => ({
            results: [
              {
                id: "ev_old",
                title: "Winter Concert",
                event_start_date: "2025-12-01",
                requirements: JSON.stringify({
                  poc_name: "Ada Lovelace",
                  poc_email: "ada@example.test",
                  poc_contact_number: "9999999999",
                }),
              },
            ],
          }),
        };
      }
      if (sql.includes("FROM contacts")) return { first: () => null };
      return {};
    });

    const result = await getOrgPocSuggestion(db, "org_a");
    expect(result.source).toMatchObject({
      type: "event",
      event_id: "ev_old",
      event_title: "Winter Concert",
    });
    expect(result.suggestion).toMatchObject({
      poc_name: "Ada Lovelace",
      poc_email: "ada@example.test",
      poc_contact_number: "9999999999",
    });
    expect(result.preview).toEqual({
      poc_name: "Ada Lovelace",
      poc_email: "ada@example.test",
    });
  });

  it("falls back to organisation directory data when no event POC exists", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM organisations WHERE id = ? AND is_archived = 0")) {
        return {
          first: () => ({
            id: "org_b",
            name: "New Client",
            gst_number: "27AAATT3454F1ZI",
            pan_number: "ABCDE1234F",
            tan_number: null,
            bank_details: JSON.stringify({
              bank: "HDFC",
              account_name: "New Client",
              account_no: "1234567890",
            }),
          }),
        };
      }
      if (sql.includes("FROM events e")) return { all: () => ({ results: [] }) };
      if (sql.includes("FROM contacts")) {
        return {
          first: () => ({
            name: "Priya Shah",
            email: "priya@example.test",
            phone: "9876543210",
            courier_address: "Mumbai",
          }),
        };
      }
      return {};
    });

    const result = await getOrgPocSuggestion(db, "org_b");
    expect(result.source).toEqual({ type: "organisation" });
    expect(result.suggestion).toMatchObject({
      poc_name: "Priya Shah",
      poc_email: "priya@example.test",
      poc_contact_number: "9876543210",
      courier_address: "Mumbai",
      gst_no: "27AAATT3454F1ZI",
      pan_no: "ABCDE1234F",
    });
    expect(result.suggestion.bank_details).toContain("HDFC");
  });

  it("merges missing tax fields from the organisation directory into event POC", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("FROM organisations WHERE id = ? AND is_archived = 0")) {
        return {
          first: () => ({
            id: "org_c",
            name: "Repeat Client",
            gst_number: "27AAATT3454F1ZI",
            pan_number: null,
            tan_number: null,
            bank_details: null,
          }),
        };
      }
      if (sql.includes("FROM events e")) {
        return {
          all: () => ({
            results: [
              {
                id: "ev_repeat",
                title: "Annual Day",
                event_start_date: "2026-01-15",
                requirements: JSON.stringify({
                  poc_name: "Ravi Kumar",
                  poc_email: "ravi@example.test",
                }),
              },
            ],
          }),
        };
      }
      if (sql.includes("FROM contacts")) return { first: () => null };
      return {};
    });

    const result = await getOrgPocSuggestion(db, "org_c");
    expect(result.source?.type).toBe("event");
    expect(result.suggestion).toMatchObject({
      poc_name: "Ravi Kumar",
      poc_email: "ravi@example.test",
      gst_no: "27AAATT3454F1ZI",
    });
  });
});
