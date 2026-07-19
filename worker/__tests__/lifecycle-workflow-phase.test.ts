import { describe, expect, it } from "vitest";
import {
  accountsStartDate,
  canGenerateTaskForPhase,
  completedWorkflowPhases,
  finalShowDate,
  getActiveWorkflowPhase,
  isFileClosedValue,
  isWorkflowPhaseVisible,
  workflowPhaseForTaskRule,
} from "../lib/lifecycle-workflow-phase";

describe("lifecycle workflow phase", () => {
  it("stays in confirm until the event is confirmed", () => {
    expect(getActiveWorkflowPhase({
      status: "enquiry",
      eventStartDate: "2026-07-01",
      eventEndDate: null,
    }, "2026-07-10")).toBe("confirm");

    expect(getActiveWorkflowPhase({
      status: "approved",
      eventStartDate: "2026-07-01",
      eventEndDate: "2026-07-03",
    }, "2026-07-10")).toBe("confirm");
  });

  it("uses event readiness through the first show date", () => {
    expect(getActiveWorkflowPhase({
      status: "confirmed",
      eventStartDate: "2026-07-10",
      eventEndDate: "2026-07-12",
    }, "2026-07-09")).toBe("event");

    expect(getActiveWorkflowPhase({
      status: "confirmed",
      eventStartDate: "2026-07-10",
      eventEndDate: "2026-07-12",
    }, "2026-07-10")).toBe("event");
  });

  it("uses duringEvent between first show + 1 and final show day", () => {
    expect(getActiveWorkflowPhase({
      status: "confirmed",
      eventStartDate: "2026-07-10",
      eventEndDate: "2026-07-12",
    }, "2026-07-11")).toBe("duringEvent");

    expect(getActiveWorkflowPhase({
      status: "confirmed",
      eventStartDate: "2026-07-10",
      eventEndDate: "2026-07-12",
    }, "2026-07-12")).toBe("duringEvent");
  });

  it("starts accounts the day after the final show (single-day next day)", () => {
    expect(accountsStartDate("2026-07-10", null)).toBe("2026-07-11");
    expect(getActiveWorkflowPhase({
      status: "confirmed",
      eventStartDate: "2026-07-10",
      eventEndDate: null,
    }, "2026-07-11")).toBe("accounts");
  });

  it("starts accounts the day after the last day of a multi-day event", () => {
    expect(accountsStartDate("2026-07-10", "2026-07-12")).toBe("2026-07-13");
    expect(getActiveWorkflowPhase({
      status: "confirmed",
      eventStartDate: "2026-07-10",
      eventEndDate: "2026-07-12",
    }, "2026-07-13")).toBe("accounts");
  });

  it("marks complete when the file is closed", () => {
    expect(getActiveWorkflowPhase({
      status: "confirmed",
      eventStartDate: "2026-07-01",
      eventEndDate: null,
      fileClosed: true,
    }, "2026-07-20")).toBe("complete");
  });

  it("uses terminal for regret/cancelled", () => {
    expect(getActiveWorkflowPhase({
      status: "regret",
      eventStartDate: "2026-07-10",
      eventEndDate: null,
    }, "2026-07-01")).toBe("terminal");
  });

  it("exposes completed phases for collapse", () => {
    expect(completedWorkflowPhases("event")).toEqual(["confirm"]);
    expect(completedWorkflowPhases("accounts")).toEqual(["confirm", "event"]);
    expect(completedWorkflowPhases("complete")).toEqual(["confirm", "event", "accounts"]);
  });

  it("hides future phases and shows completed ones", () => {
    expect(isWorkflowPhaseVisible("accounts", "event")).toBe(false);
    expect(isWorkflowPhaseVisible("confirm", "event")).toBe(true);
    expect(isWorkflowPhaseVisible("event", "accounts")).toBe(true);
  });

  it("maps task rules to phases and gates generation", () => {
    expect(workflowPhaseForTaskRule("poc_incomplete")).toBe("confirm");
    expect(workflowPhaseForTaskRule("event_form_readiness:venues")).toBe("event");
    expect(workflowPhaseForTaskRule("feedback")).toBe("accounts");
    expect(canGenerateTaskForPhase("feedback", "event")).toBe(false);
    expect(canGenerateTaskForPhase("feedback", "accounts")).toBe(true);
    expect(canGenerateTaskForPhase("event_form_readiness:venues", "confirm")).toBe(false);
    expect(canGenerateTaskForPhase("instalment", "duringEvent")).toBe(true);
    expect(canGenerateTaskForPhase("poc_incomplete", "complete")).toBe(false);
  });

  it("treats file closed values correctly", () => {
    expect(isFileClosedValue(null)).toBe(false);
    expect(isFileClosedValue("No")).toBe(false);
    expect(isFileClosedValue("2026-07-19")).toBe(true);
    expect(isFileClosedValue("Yes")).toBe(true);
  });

  it("resolves final show date", () => {
    expect(finalShowDate("2026-07-10", null)).toBe("2026-07-10");
    expect(finalShowDate("2026-07-10", "2026-07-12")).toBe("2026-07-12");
  });
});
