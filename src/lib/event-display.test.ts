import { describe, expect, it } from "vitest";
import { eventContextLines, eventDisplayName } from "./event-display";

describe("eventDisplayName", () => {
  it("strips a redundant organisation prefix from the event title", () => {
    expect(eventDisplayName("Acme Corp - Annual Gala", "Acme Corp")).toBe("Annual Gala");
  });
});

describe("eventContextLines", () => {
  it("shows organisation first and event second when both differ", () => {
    expect(eventContextLines("Cathedral and John Connon Senior School", "Technical Meeting")).toEqual({
      primary: "Cathedral and John Connon Senior School",
      secondary: "Technical Meeting",
    });
  });

  it("hides the secondary line when the event title matches the organisation", () => {
    expect(eventContextLines("Acme Corp", "Acme Corp")).toEqual({
      primary: "Acme Corp",
      secondary: null,
    });
  });

  it("falls back to No organisation when the organisation is missing", () => {
    expect(eventContextLines(null, "Annual Gala")).toEqual({
      primary: "No organisation",
      secondary: "Annual Gala",
    });
  });
});
