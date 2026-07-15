import { describe, expect, it } from "vitest";
import {
  deriveExecutionSectionStatus,
  EXECUTION_SECTION_STATUS,
  isExecutionSectionCaptured,
  shouldPreserveExecutionSectionValue,
} from "../lib/requirement-sections";

describe("execution section rollup", () => {
  it("detects captured sound & light from free text", () => {
    expect(isExecutionSectionCaptured("exec_sound_light", { sound: "8-channel PA" })).toBe(true);
    expect(isExecutionSectionCaptured("exec_sound_light", {})).toBe(false);
  });

  it("ignores placeholder defaults for staffing", () => {
    expect(isExecutionSectionCaptured("exec_staffing", {
      green_rooms_required: "Not Required",
      ushers_required: "Not Required",
    })).toBe(false);
    expect(isExecutionSectionCaptured("exec_staffing", {
      green_rooms_required: "Required",
    })).toBe(true);
  });

  it("derives Captured on form vs Not started", () => {
    expect(deriveExecutionSectionStatus("exec_operations", { parking: "VIP bay" }))
      .toBe(EXECUTION_SECTION_STATUS.captured);
    expect(deriveExecutionSectionStatus("exec_operations", {}))
      .toBe(EXECUTION_SECTION_STATUS.notStarted);
  });

  it("treats Licences Awaiting as operations captured", () => {
    expect(isExecutionSectionCaptured("exec_operations", { licenses_status: "Awaiting" })).toBe(true);
    expect(isExecutionSectionCaptured("exec_operations", { licenses_status: "Not required" })).toBe(false);
  });

  it("preserves Verified and Not applicable during sync", () => {
    expect(shouldPreserveExecutionSectionValue("Verified")).toBe(true);
    expect(shouldPreserveExecutionSectionValue("Not applicable")).toBe(true);
    expect(shouldPreserveExecutionSectionValue("Captured on form")).toBe(false);
  });
});
