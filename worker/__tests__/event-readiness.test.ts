import { describe, expect, it } from "vitest";
import { calculateEventFormReadiness, readinessSectionKeyFromRule, readinessTaskRule } from "../lib/event-readiness";

describe("event form readiness", () => {
  it("starts red without treating silent defaults as progress", () => {
    const readiness = calculateEventFormReadiness({});
    expect(readiness.percentage).toBe(0);
    expect(readiness.sections.every((section) => section.state === "missing")).toBe(true);
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
  });

  it("expands conditional details and reports their labels", () => {
    const readiness = calculateEventFormReadiness({
      catering_required: "Yes",
      catering_provider: "NCPA caterer",
      interval: "No",
      catering_breakfast_required: "Yes",
    });
    const catering = readiness.sections.find((section) => section.key === "catering");
    expect(catering?.state).toBe("partial");
    expect(catering?.missingKeys).toContain("catering_breakfast_pax");
    expect(catering?.missingLabels).toContain("Breakfast pax");
  });

  it("round-trips readiness task rules", () => {
    const rule = readinessTaskRule("technical_sound");
    expect(rule).toBe("event_form_readiness:technical_sound");
    expect(readinessSectionKeyFromRule(rule)).toBe("technical_sound");
    expect(readinessSectionKeyFromRule("feedback")).toBeNull();
  });
});
