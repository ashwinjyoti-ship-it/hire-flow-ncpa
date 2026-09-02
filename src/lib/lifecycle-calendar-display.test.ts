import { describe, expect, it } from "vitest";
import { NO_DATE_OF_SHOW_LABEL, showDateMissing, showDateMissingLabel } from "./lifecycle-calendar-display";

describe("show date missing copy", () => {
  it("treats a blank start date as no date of show", () => {
    expect(showDateMissing(null)).toBe(true);
    expect(showDateMissing("")).toBe(true);
    expect(showDateMissing("2026-09-02")).toBe(false);
  });

  it("uses one label everywhere", () => {
    expect(showDateMissingLabel()).toBe(NO_DATE_OF_SHOW_LABEL);
    expect(showDateMissingLabel(true)).toBe("No date");
  });
});
