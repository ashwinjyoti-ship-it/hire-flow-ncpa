import { describe, expect, it } from "vitest";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, formatActivityType } from "../lib/types";

describe("schedule activity types", () => {
  it("exposes zero show instead of technical meeting", () => {
    expect(ACTIVITY_TYPES).toContain("zero_show");
    expect(ACTIVITY_TYPES).not.toContain("technical_meeting");
    expect(ACTIVITY_TYPE_LABELS.zero_show).toBe("Zero Show");
  });

  it("formats activity labels for the event form", () => {
    expect(formatActivityType("zero_show")).toBe("Zero Show");
    expect(formatActivityType("technical_meeting")).toBe("technical meeting");
  });
});
