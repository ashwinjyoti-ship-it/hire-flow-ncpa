import { describe, expect, it } from "vitest";
import {
  applyPocSuggestion,
  countApplicablePocSuggestionFields,
  formatPocSuggestionSourceLabel,
  hasAnyPocSuggestionValues,
} from "./org-poc-suggestion";

describe("org-poc-suggestion helpers", () => {
  it("counts only empty fields that the suggestion can fill", () => {
    expect(countApplicablePocSuggestionFields(
      { poc_name: "Existing", poc_email: "" },
      { poc_name: "Ada", poc_email: "ada@example.test", poc_contact_number: "999" },
    )).toBe(2);
  });

  it("applies suggestion values without overwriting existing input", () => {
    const next = applyPocSuggestion(
      { poc_name: "Existing", poc_email: "", bank_details: "" },
      {
        poc_name: "Ada",
        poc_email: "ada@example.test",
        bank_details: "HDFC",
        signing_authority_address: "Mumbai",
      },
    );
    expect(next).toEqual({
      poc_name: "Existing",
      poc_email: "ada@example.test",
      bank_details: "HDFC",
      signing_authority_address: "Mumbai",
    });
  });

  it("formats event and organisation source labels", () => {
    expect(formatPocSuggestionSourceLabel({
      type: "event",
      event_id: "ev_1",
      event_title: "Winter Concert",
      event_start_date: "2025-12-01",
    }, "Symphony Orchestra")).toContain("Winter Concert");

    expect(formatPocSuggestionSourceLabel({ type: "organisation" }, "Symphony Orchestra"))
      .toContain("organisation directory");
  });

  it("detects when a suggestion has values", () => {
    expect(hasAnyPocSuggestionValues({ poc_name: "Ada" })).toBe(true);
    expect(hasAnyPocSuggestionValues({ poc_name: "" })).toBe(false);
  });
});
