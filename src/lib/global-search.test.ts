import { describe, expect, it, vi } from "vitest";
import {
  calendarUrlForSearch,
  calendarViewForEvent,
  matchesSearchTerm,
  monthStartFromIsoDate,
  resolveCalendarAnchorDate,
  searchContextFromPath,
} from "./global-search";
import { normaliseCalendarDate } from "./lifecycle-calendar-links";
import { apiGet } from "./api";

vi.mock("./api", () => ({
  apiGet: vi.fn(),
}));

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

  it("normalizes imported show dates when resolving calendar anchors", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      events: [
        {
          id: "ev_er2",
          title: "ER2 Entertainment - Play - Is there room on the broom",
          event_start_date: "09-Aug-2026",
          status: "confirmed",
        },
      ],
    });

    await expect(resolveCalendarAnchorDate("ER2 Entertainment", "show", {
      statusQuery: "&status=confirmed",
      eventId: "ev_er2",
    })).resolves.toBe("2026-08-09");
  });

  it("builds show-calendar URLs from normalized imported dates", () => {
    expect(normaliseCalendarDate("09-Aug-2026")).toBe("2026-08-09");
    expect(calendarUrlForSearch("ER2 Entertainment", "show", normaliseCalendarDate("09-Aug-2026"))).toBe(
      "/calendar?view=show&q=ER2+Entertainment&from=2026-08-01",
    );
  });
});
