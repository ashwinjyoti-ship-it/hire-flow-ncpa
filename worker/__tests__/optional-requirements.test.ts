import { describe, expect, it } from "vitest";
import {
  OPTIONAL_NOT_APPLICABLE,
  isOptionalAffirmative,
  isOptionalSettled,
  optionalGroupDetailsFilled,
  optionalGroupNotApplicable,
} from "../lib/optional-requirements";

describe("optional requirements", () => {
  it("treats empty and N/A as settled", () => {
    expect(OPTIONAL_NOT_APPLICABLE).toBe("N/A");
    expect(isOptionalSettled("")).toBe(true);
    expect(isOptionalSettled("N/A")).toBe(true);
    expect(isOptionalSettled("No")).toBe(true);
    expect(isOptionalSettled("Yes")).toBe(false);
  });

  it("recognises affirmative values", () => {
    expect(isOptionalAffirmative("Required")).toBe(true);
    expect(isOptionalAffirmative("Keep")).toBe(true);
    expect(isOptionalAffirmative("Not Required")).toBe(false);
  });

  it("checks detail groups only for affirmative toggles", () => {
    const values = { stalls: "Yes", stalls_note: "" };
    expect(
      optionalGroupDetailsFilled(values, [{ toggle: "stalls", details: ["stalls_note"] }]),
    ).toBe(false);
    expect(
      optionalGroupDetailsFilled({ stalls: "Yes", stalls_note: "3 stalls" }, [{ toggle: "stalls", details: ["stalls_note"] }]),
    ).toBe(true);
    expect(
      optionalGroupDetailsFilled({ stalls: "" }, [{ toggle: "stalls", details: ["stalls_note"] }]),
    ).toBe(true);
  });

  it("marks groups not applicable when nothing is affirmative", () => {
    expect(optionalGroupNotApplicable({ a: "", b: "No" }, ["a", "b"])).toBe(true);
    expect(optionalGroupNotApplicable({ a: "Yes" }, ["a"])).toBe(false);
  });
});
