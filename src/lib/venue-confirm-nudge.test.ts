import { describe, expect, it } from "vitest";
import {
  getTentativeVenueNames,
  isConfirmationLetterSent,
  shouldShowConfirmVenueNudge,
} from "./venue-confirm-nudge";

describe("venue-confirm-nudge", () => {
  it("treats couriered and signed confirmation as sent", () => {
    expect(isConfirmationLetterSent("couriered")).toBe(true);
    expect(isConfirmationLetterSent("signed_received")).toBe(true);
    expect(isConfirmationLetterSent("made")).toBe(false);
  });

  it("lists only tentative venues", () => {
    expect(getTentativeVenueNames([
      { venue: "JBT", booking_status: "tentative" },
      { venue: "Tata", booking_status: "confirmed" },
    ])).toEqual(["JBT"]);
  });

  it("shows the nudge when payment is complete, letter sent, and a venue is tentative", () => {
    expect(shouldShowConfirmVenueNudge({
      eventStatus: "tentative",
      paymentStatus: "Completed",
      confirmationStatus: "couriered",
      venueBookings: [{ venue: "JBT", booking_status: "tentative" }],
      dismissed: false,
    })).toBe(true);
  });

  it("hides the nudge when payment is incomplete or venues are confirmed", () => {
    expect(shouldShowConfirmVenueNudge({
      eventStatus: "tentative",
      paymentStatus: "Incomplete",
      confirmationStatus: "couriered",
      venueBookings: [{ venue: "JBT", booking_status: "tentative" }],
      dismissed: false,
    })).toBe(false);

    expect(shouldShowConfirmVenueNudge({
      eventStatus: "tentative",
      paymentStatus: "Completed",
      confirmationStatus: "couriered",
      venueBookings: [{ venue: "JBT", booking_status: "confirmed" }],
      dismissed: false,
    })).toBe(false);
  });
});
