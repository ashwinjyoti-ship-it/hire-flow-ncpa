import { describe, expect, it } from "vitest";
import { canCreateEvent } from "./event-edit-form";

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
