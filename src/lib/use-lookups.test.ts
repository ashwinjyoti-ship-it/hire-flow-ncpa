import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime, formatTimeRange } from "./use-lookups";

describe("date and time display formatters", () => {
  it("formats dates as MM/DD/YYYY", () => {
    expect(formatDate("2026-07-10")).toBe("07/10/2026");
  });

  it("formats timestamps as MM/DD/YYYY HH:MM in 24-hour time", () => {
    expect(formatDateTime("2026-07-10T18:45:00+05:30")).toBe("07/10/2026 18:45");
    expect(formatDateTime("2026-07-10T00:05:00+05:30")).toBe("07/10/2026 00:05");
  });

  it("formats time-only values in 24-hour time", () => {
    expect(formatTime("7:05")).toBe("07:05");
    expect(formatTime("18:45")).toBe("18:45");
    expect(formatTimeRange("09:00", "17:30")).toBe("09:00 - 17:30");
  });
});
