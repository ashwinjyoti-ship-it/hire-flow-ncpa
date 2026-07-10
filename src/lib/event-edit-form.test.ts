import { describe, expect, it } from "vitest";
import { canCreateEvent, organisationValueFromName } from "./event-edit-form";

describe("canCreateEvent", () => {
  it("allows submission when organisation, event name, and date are filled", () => {
    expect(
      canCreateEvent({
        title: "A New Event",
        organisation_id: "org_1",
        event_start_date: "2026-07-10",
      }),
    ).toBe(true);
  });

  it("allows submission when the organisation is typed as a new name", () => {
    expect(
      canCreateEvent({
        title: "A New Event",
        organisation_id: "new:Typed Organisation",
        event_start_date: "2026-07-10",
      }),
    ).toBe(true);
  });

  it("blocks submission when the date is missing", () => {
    expect(
      canCreateEvent({
        title: "A New Event",
        organisation_id: "org_1",
        event_start_date: null,
      }),
    ).toBe(false);
  });
});

describe("organisationValueFromName", () => {
  it("stores typed organisation text as a new organisation value", () => {
    expect(organisationValueFromName(" Test Organisation ")).toBe("new:Test Organisation");
  });

  it("clears the form value when the typed organisation is blank", () => {
    expect(organisationValueFromName("   ")).toBe("");
  });
});
