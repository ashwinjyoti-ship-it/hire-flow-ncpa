import { describe, expect, it } from "vitest";
import {
  calculateEventFormReadiness,
  readinessSectionKeyFromRule,
  readinessTaskCopy,
  readinessTaskRule,
} from "../lib/event-readiness";
import {
  CANTEEN_IN_INTERVAL_KEY,
  SIT_DOWN_MEALS_REQUIRED_KEY,
  THEATRE_CANTEEN_REQUIRED_KEY,
} from "../lib/theatre-canteen";

describe("event form readiness", () => {
  it("starts red without treating silent defaults as progress", () => {
    const readiness = calculateEventFormReadiness({});
    expect(readiness.percentage).toBe(0);
    expect(readiness.sections.find((section) => section.key === "venues_schedule")?.state).toBe("missing");
    expect(readiness.sections.find((section) => section.key === "technical_sound")?.state).toBe("missing");
    expect(readiness.sections.find((section) => section.key === "staffing_facilities")?.state).toBe("not_applicable");
    expect(readiness.sections.find((section) => section.key === "recording_special")?.state).toBe("not_applicable");
  });

  it("marks explicit negative applicability decisions grey", () => {
    const readiness = calculateEventFormReadiness({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "No",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "No",
      decorator_required: "No",
      green_rooms_required: "Not Required",
      ushers_required: "Not Required",
      loaders_required: "Not Required",
      house_seats_release: "No",
      video_recording: "No",
      piano_required: "No",
      liquor_licence: "Not Required",
    });
    expect(readiness.sections.find((section) => section.key === "catering")?.state).toBe("not_applicable");
    expect(readiness.sections.find((section) => section.key === "decorator")?.state).toBe("not_applicable");
    expect(readiness.sections.find((section) => section.key === "recording_special")?.state).toBe("not_applicable");
    expect(readiness.sections.find((section) => section.key === "staffing_facilities")?.state).toBe("not_applicable");
  });

  it("uses a general meals rollup instead of per-meal task labels", () => {
    const readiness = calculateEventFormReadiness({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "No",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "Yes",
      catering_provider: "NCPA caterer",
      catering_hi_tea_required: "Yes",
    });
    const catering = readiness.sections.find((section) => section.key === "catering");
    expect(catering?.state).toBe("almost");
    expect(catering?.missingLabels).toContain("Are meals filled?");
    expect(catering?.missingLabels).not.toContain("Hi-Tea pax");
    const task = readinessTaskCopy(catering!);
    expect(task.title).toContain("Are meals filled?");
    expect(task.title).not.toContain("Hi-Tea");
  });

  it("requires theatre canteen timings when canteen is yes", () => {
    const readiness = calculateEventFormReadiness({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "Yes",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "No",
      canteen_before_show: "No",
      [CANTEEN_IN_INTERVAL_KEY]: "No",
    });
    const catering = readiness.sections.find((section) => section.key === "catering");
    expect(catering?.state).toBe("almost");
    expect(catering?.missingLabels).toContain("Are theatre canteen timings filled?");
  });

  it("does not mention meals when sit-down is no", () => {
    const readiness = calculateEventFormReadiness({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "Yes",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "No",
      canteen_before_show: "Yes",
      [CANTEEN_IN_INTERVAL_KEY]: "No",
    });
    const catering = readiness.sections.find((section) => section.key === "catering");
    expect(catering?.state).toBe("complete");
    expect(catering?.missingLabels).toEqual([]);
    expect(catering?.total).toBe(4);
  });

  it("treats legacy No on a meal the same as N/A", () => {
    const readiness = calculateEventFormReadiness({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "No",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "Yes",
      catering_provider: "NCPA caterer",
      catering_dinner_required: "No",
    });
    expect(readiness.sections.find((section) => section.key === "catering")?.state).toBe("complete");
  });

  it("completes catering when only one meal is required and pax is filled", () => {
    const readiness = calculateEventFormReadiness({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "No",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "Yes",
      catering_provider: "NCPA caterer",
      catering_dinner_required: "Yes",
      catering_dinner_pax: "120",
    });
    expect(readiness.sections.find((section) => section.key === "catering")?.state).toBe("complete");
  });

  it("omits between-shows timing when only one show is scheduled that day", () => {
    const readiness = calculateEventFormReadiness({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "Yes",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "No",
      canteen_before_show: "Yes",
      [CANTEEN_IN_INTERVAL_KEY]: "No",
    }, [
      { venue: "TET", schedule_entries: [{ activity_type: "show", activity_date: "2026-08-28" }] },
    ]);
    const catering = readiness.sections.find((section) => section.key === "catering");
    expect(catering?.missingKeys).not.toContain("canteen_between_shows");
    expect(catering?.total).toBe(4);
  });

  it("includes between-shows timing when multiple shows share a day", () => {
    const readiness = calculateEventFormReadiness({
      [THEATRE_CANTEEN_REQUIRED_KEY]: "Yes",
      [SIT_DOWN_MEALS_REQUIRED_KEY]: "No",
      canteen_before_show: "Yes",
      [CANTEEN_IN_INTERVAL_KEY]: "No",
    }, [
      {
        venue: "TET",
        schedule_entries: [
          { activity_type: "show", activity_date: "2026-08-28" },
          { activity_type: "show", activity_date: "2026-08-28" },
        ],
      },
    ]);
    const catering = readiness.sections.find((section) => section.key === "catering");
    expect(catering?.missingKeys).toContain("canteen_between_shows");
    expect(catering?.total).toBe(5);
  });

  it("uses staffing rollup when an option is affirmative but details are missing", () => {
    const readiness = calculateEventFormReadiness({
      ushers_required: "Required",
    });
    const staffing = readiness.sections.find((section) => section.key === "staffing_facilities");
    expect(staffing?.state).toBe("partial");
    expect(staffing?.missingLabels).toEqual(["Are staffing options filled?"]);
  });

  it("uses recording rollup for partial special options", () => {
    const readiness = calculateEventFormReadiness({
      piano_required: "Yes",
    });
    const recording = readiness.sections.find((section) => section.key === "recording_special");
    expect(recording?.missingLabels).toEqual(["Are recording options filled?"]);
  });

  it("does not require additional add-on note text for readiness tasks", () => {
    const readiness = calculateEventFormReadiness({
      stage_setup: "Full stage",
      foyer_setup: "Reception desk",
      stalls: "Yes",
    });
    const additional = readiness.sections.find((section) => section.key === "additional");
    expect(additional?.missingLabels).toEqual([]);
    expect(additional?.state).toBe("complete");
  });

  it("does not create additional add-on tasks when optional dropdowns are left as default N/A", () => {
    const readiness = calculateEventFormReadiness({
      stage_setup: "Full stage",
      foyer_setup: "Reception desk",
    });
    const additional = readiness.sections.find((section) => section.key === "additional");
    expect(additional?.missingLabels).toEqual([]);
    expect(additional?.state).toBe("complete");
  });

  it("round-trips readiness task rules", () => {
    const rule = readinessTaskRule("technical_sound");
    expect(rule).toBe("event_form_readiness:technical_sound");
    expect(readinessSectionKeyFromRule(rule)).toBe("technical_sound");
    expect(readinessSectionKeyFromRule("feedback")).toBeNull();
  });

  it("includes venue schedule readiness ahead of requirement sections", () => {
    const readiness = calculateEventFormReadiness({}, [
      { venue: "TET", schedule_entries: [{ activity_type: "show", activity_date: "2026-08-28" }] },
      { venue: "JBT", schedule_entries: [] },
    ]);
    const venueSection = readiness.sections[0];
    expect(venueSection?.key).toBe("venues_schedule");
    expect(venueSection?.state).toBe("partial");
    expect(venueSection?.missingLabels).toEqual(["JBT: add activity schedule"]);
    expect(readiness.missingCount).toBeGreaterThan(0);
  });
});
