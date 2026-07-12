import { describe, expect, it } from "vitest";
import { dateStr } from "../seed/import-events";

describe("event import date normalization", () => {
  it("treats numeric spreadsheet dates as DD/MM/YYYY", () => {
    expect(dateStr("01/07/2026")).toBe("2026-07-01");
    expect(dateStr("10/07/2026")).toBe("2026-07-10");
  });

  it("normalizes DD-Mmm-YYYY dates", () => {
    expect(dateStr("04-Jul-2026")).toBe("2026-07-04");
  });
});
