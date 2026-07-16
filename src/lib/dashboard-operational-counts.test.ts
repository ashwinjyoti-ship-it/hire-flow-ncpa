import { describe, expect, it } from "vitest";
import {
  dashboardOperationalCounts,
  dedupeLifecycleEntries,
  operationalLifecycleEntries,
  type OperationalLifecycleEntry,
} from "./dashboard-operational-counts";

function entry(overrides: Partial<OperationalLifecycleEntry> & Pick<OperationalLifecycleEntry, "event_id" | "status">): OperationalLifecycleEntry {
  return {
    id: `current_${overrides.event_id}`,
    title: overrides.event_id,
    milestone_date: "2026-07-10",
    event_start_date: "2026-08-01",
    event_end_date: null,
    organisation_name: "NCPA",
    venues: "JBT",
    ...overrides,
  };
}

describe("dashboard operational lifecycle", () => {
  it("collapses duplicate imported records and keeps the furthest status", () => {
    const rows = [
      entry({ event_id: "enquiry_copy", status: "enquiry", title: "Annual Day" }),
      entry({ event_id: "confirmed_copy", status: "confirmed", title: "Annual Day" }),
    ];
    expect(dedupeLifecycleEntries(rows)).toEqual([expect.objectContaining({ event_id: "confirmed_copy", status: "confirmed" })]);
  });

  it("keeps only bounded operational counts", () => {
    const rows = [
      entry({ event_id: "recent_undated", status: "enquiry", event_start_date: null, enquiry_date: "2026-07-01" }),
      entry({ event_id: "stale_undated", status: "enquiry", event_start_date: null, enquiry_date: "2026-05-01" }),
      entry({ event_id: "imported_undated", status: "enquiry", event_start_date: null, enquiry_date: null, milestone_date: "2026-07-16" }),
      entry({ event_id: "future_tentative", status: "tentative" }),
      entry({ event_id: "past_approved", status: "approved", event_start_date: "2026-06-01" }),
      entry({ event_id: "future_confirmed", status: "confirmed" }),
      entry({ event_id: "past_confirmed", status: "confirmed", event_start_date: "2026-06-01" }),
      entry({ event_id: "cancelled", status: "cancelled" }),
    ];

    expect(dashboardOperationalCounts(rows, "2026-07-16")).toEqual({
      activeEnquiries: 1,
      awaitingConfirmation: 1,
      upcomingConfirmed: 1,
    });
    expect(operationalLifecycleEntries(rows, "2026-07-16").map((row) => row.event_id)).toEqual([
      "recent_undated",
      "future_tentative",
      "future_confirmed",
    ]);
  });

  it("drops a confirmed event after its start date even when it has not ended", () => {
    const alreadyStarted = entry({
      event_id: "already_started",
      status: "confirmed",
      event_start_date: "2026-07-14",
      event_end_date: "2026-07-17",
    });
    const startsToday = entry({
      event_id: "starts_today",
      status: "confirmed",
      event_start_date: "2026-07-16",
      event_end_date: "2026-07-18",
    });
    expect(dashboardOperationalCounts([alreadyStarted, startsToday], "2026-07-16").upcomingConfirmed).toBe(1);
  });
});
