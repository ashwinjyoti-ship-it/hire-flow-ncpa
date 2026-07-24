import { describe, expect, it } from "vitest";
import {
  calendarUrlForSearch,
  calendarViewForEvent,
  matchesSearchTerm,
  monthStartFromIsoDate,
  searchContextFromPath,
} from "./global-search";

describe("global-search", () => {
  it("routes confirmed events to the show calendar", () => {
    expect(calendarViewForEvent({ status: "confirmed" } as never, "lifecycle")).toBe("show");
    expect(calendarViewForEvent({ status: "enquiry" } as never, "lifecycle")).toBe("lifecycle");
  });

  it("builds calendar URLs with month-start anchors", () => {
    expect(calendarUrlForSearch("Blue Banyan", "lifecycle", "2026-06-12")).toBe(
      "/calendar?view=lifecycle&q=Blue+Banyan&from=2026-06-01",
    );
    expect(monthStartFromIsoDate("2026-09-18")).toBe("2026-09-01");
  });

  it("detects page context for search routing", () => {
    expect(searchContextFromPath("/dashboard")).toBe("dashboard");
    expect(searchContextFromPath("/tasks")).toBe("tasks");
    expect(searchContextFromPath("/calendar")).toBe("calendar");
    expect(searchContextFromPath("/organisations")).toBe("default");
  });

  it("matches organisation, event, and task text", () => {
    expect(matchesSearchTerm("blue", "Blue Banyan Media", "Other")).toBe(true);
    expect(matchesSearchTerm("summit", "Blue Banyan Media - Corporate Leadership Summit")).toBe(true);
    expect(matchesSearchTerm("acme", "Blue Banyan Media")).toBe(false);
  });
});
