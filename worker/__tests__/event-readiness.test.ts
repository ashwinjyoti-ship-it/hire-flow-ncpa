import { describe, expect, it } from "vitest";
import {
  calculateEventFormReadiness,
  readinessSectionKeyFromRule,
  readinessTaskCopy,
  readinessTaskRule,
} from "../lib/event-readiness";

describe("event form readiness", () => {
  it("starts red without treating silent defaults as progress", () => {
    const readiness = calculateEventFormReadiness({});
    expect(readiness.percentage).toBe(0);
    expect(readiness.sections.find((section) => section.key === "technical_sound")?.state).toBe("missing");
    expect(readiness.sections.find((section) => section.key === "staffing_facilities")?.state).toBe("not_applicable");
    expect(readiness.sections.find((section) => section.key === "recording_special")?.state).toBe("not_applicable");
  });

  it("marks explicit negative applicability decisions grey", () => {
    const readiness = calculateEventFormReadiness({
      catering_required: "No",
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
      catering_required: "Yes",
      catering_provider: "NCPA caterer",
      interval: "No",
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

  it("does not mention meals when all meal rows are N/A", () => {
    const readiness = calculateEventFormReadiness({
      catering_required: "Yes",
      catering_provider: "NCPA caterer",
      interval: "No",
    });
    const catering = readiness.sections.find((section) => section.key === "catering");
    expect(catering?.state).toBe("complete");
    expect(catering?.missingLabels).toEqual([]);
    expect(catering?.total).toBe(3);
  });

  it("only surfaces meals when a Yes row is missing pax", () => {
    const readiness = calculateEventFormReadiness({
      catering_required: "Yes",
      catering_provider: "NCPA caterer",
      interval: "No",
      catering_dinner_required: "Yes",
      catering_dinner_pax: "120",
    });
    expect(readiness.sections.find((section) => section.key === "catering")?.state).toBe("complete");
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

  it("uses additional rollup for optional add-ons", () => {
    const readiness = calculateEventFormReadiness({
      stage_setup: "Full stage",
      foyer_setup: "Reception desk",
      stalls: "Yes",
    });
    const additional = readiness.sections.find((section) => section.key === "additional");
    expect(additional?.missingLabels).toEqual(["Are optional add-ons filled?"]);
  });

  it("round-trips readiness task rules", () => {
    const rule = readinessTaskRule("technical_sound");
    expect(rule).toBe("event_form_readiness:technical_sound");
    expect(readinessSectionKeyFromRule(rule)).toBe("technical_sound");
    expect(readinessSectionKeyFromRule("feedback")).toBeNull();
  });
});
