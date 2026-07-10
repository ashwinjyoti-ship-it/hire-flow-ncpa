import { describe, expect, it } from "vitest";
import { getConfirmedShowCalendarHref, getLifecycleCalendarHref } from "./lifecycle-calendar-links";

describe("getLifecycleCalendarHref", () => {
  const today = new Date("2026-07-10T00:00:00");

  it("opens the next matching lifecycle month when a dashboard status has upcoming records", () => {
    const href = getLifecycleCalendarHref([
      { milestone_type: "enquiry", milestone_date: "2026-05-03" },
      { milestone_type: "enquiry", milestone_date: "2026-08-12" },
      { milestone_type: "tentative", milestone_date: "2026-07-15" },
    ], "enquiry", today);

    expect(href).toBe("/calendar?view=lifecycle&status=enquiry&from=2026-08-12");
  });

  it("normalizes imported dashboard dates before choosing a calendar month", () => {
    const href = getLifecycleCalendarHref([
      { milestone_type: "tentative", milestone_date: "00-Jan-1900" },
      { milestone_type: "tentative", milestone_date: "07-Jun-2026" },
      { milestone_type: "tentative", milestone_date: "22-Jul-2026" },
    ], "tentative", today);

    expect(href).toBe("/calendar?view=lifecycle&status=tentative&from=2026-07-22");
  });

  it("does not send invalid imported dates to the calendar", () => {
    const href = getLifecycleCalendarHref([
      { milestone_type: "tentative", milestone_date: "00-Jan-1900" },
      { milestone_type: "tentative", milestone_date: "not a date" },
    ], "tentative", today);

    expect(href).toBe("/calendar?view=lifecycle&status=tentative");
  });

  it("opens the most recent matching month when all matching records are in the past", () => {
    const href = getLifecycleCalendarHref([
      { milestone_type: "confirmed", milestone_date: "2026-04-20" },
      { milestone_type: "confirmed", milestone_date: "2026-06-18" },
      { milestone_type: "enquiry", milestone_date: "2026-07-15" },
    ], "confirmed", today);

    expect(href).toBe("/calendar?view=lifecycle&status=confirmed&from=2026-06-18");
  });

  it("falls back to an un-dated filtered calendar link when no matching date exists", () => {
    const href = getLifecycleCalendarHref([
      { milestone_type: "enquiry", milestone_date: "" },
      { milestone_type: "tentative", milestone_date: "2026-07-15" },
    ], "enquiry", today);

    expect(href).toBe("/calendar?view=lifecycle&status=enquiry");
  });

  it("opens confirmed dashboard cards in the show calendar on the nearest show date", () => {
    const href = getConfirmedShowCalendarHref([
      { milestone_type: "confirmed", milestone_date: "2026-06-03", event_start_date: "2026-11-10" },
      { milestone_type: "confirmed", milestone_date: "2026-07-08", event_start_date: "2026-08-15" },
      { milestone_type: "enquiry", milestone_date: "2026-07-15", event_start_date: "2026-07-20" },
    ], today);

    expect(href).toBe("/calendar?view=show&status=confirmed&from=2026-08-15");
  });

  it("uses the confirmed milestone date for show navigation when no event start date exists", () => {
    const href = getConfirmedShowCalendarHref([
      { milestone_type: "confirmed", milestone_date: "2026-07-08", event_start_date: null },
    ], today);

    expect(href).toBe("/calendar?view=show&status=confirmed&from=2026-07-08");
  });

  it("normalizes imported confirmed show dates before choosing a calendar month", () => {
    const href = getConfirmedShowCalendarHref([
      { milestone_type: "confirmed", milestone_date: "07-Jun-2026", event_start_date: "30-Aug-2026" },
      { milestone_type: "confirmed", milestone_date: "22-Jul-2026", event_start_date: "00-Jan-1900" },
    ], today);

    expect(href).toBe("/calendar?view=show&status=confirmed&from=2026-07-22");
  });
});
