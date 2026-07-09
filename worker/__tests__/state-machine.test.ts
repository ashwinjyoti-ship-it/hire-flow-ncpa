import { describe, it, expect } from "vitest";
import { canTransition, requiresOverride, canConfirm, requiresApproval } from "../lib/state-machine";

describe("Event state machine", () => {
  describe("valid transitions", () => {
    it("allows the primary happy path", () => {
      expect(canTransition("enquiry", "approved")).toBe(true);
      expect(canTransition("enquiry", "confirmed")).toBe(true);
      expect(canTransition("tentative", "approved")).toBe(true);
      expect(canTransition("approved", "confirmed")).toBe(true);
    });

    it("allows tentative as a client-uncertain holding state", () => {
      expect(canTransition("enquiry", "tentative")).toBe(true);
    });

    it("allows enquiry to skip directly to confirmed", () => {
      expect(canTransition("enquiry", "confirmed")).toBe(true);
      expect(canTransition("tentative", "confirmed")).toBe(true);
    });

    it("allows regret from any pre-confirmation state", () => {
      expect(canTransition("enquiry", "regret")).toBe(true);
      expect(canTransition("tentative", "regret")).toBe(true);
      expect(canTransition("approved", "regret")).toBe(true);
    });

    it("allows cancelled from any pre-terminal state AND from confirmed", () => {
      expect(canTransition("enquiry", "cancelled")).toBe(true);
      expect(canTransition("tentative", "cancelled")).toBe(true);
      expect(canTransition("approved", "cancelled")).toBe(true);
      expect(canTransition("confirmed", "cancelled")).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("regret is terminal", () => {
      expect(canTransition("regret", "tentative")).toBe(false);
      expect(canTransition("regret", "confirmed")).toBe(false);
      expect(canTransition("regret", "enquiry")).toBe(false);
    });

    it("cancelled cannot move forward (only reopen via override)", () => {
      expect(canTransition("cancelled", "confirmed")).toBe(false);
      expect(canTransition("cancelled", "regret")).toBe(false);
    });

    it("blocks confirmed → enquiry (no back-to-start)", () => {
      expect(canTransition("confirmed", "enquiry")).toBe(false);
    });
  });

  describe("override requirements", () => {
    it("requires override to cancel a confirmed event", () => {
      expect(requiresOverride("confirmed", "cancelled")).toBe(true);
    });

    it("requires override to reopen a cancelled event", () => {
      expect(requiresOverride("cancelled", "tentative")).toBe(true);
      expect(requiresOverride("cancelled", "enquiry")).toBe(true);
    });

    it("does not require override for a normal forward transition", () => {
      expect(requiresOverride("enquiry", "tentative")).toBe(false);
      expect(requiresOverride("approved", "confirmed")).toBe(false);
      expect(requiresOverride("tentative", "regret")).toBe(false);
    });
  });

  describe("VFH approval", () => {
    it("approval is required only for VFH", () => {
      expect(requiresApproval("VFH")).toBe(true);
      expect(requiresApproval("EE")).toBe(false);
      expect(requiresApproval("FR")).toBe(false);
      expect(requiresApproval("Free Event")).toBe(false);
      expect(requiresApproval(null)).toBe(false);
    });

    it("non-VFH events can confirm with amount + signed confirmation alone", () => {
      expect(canConfirm({ eventType: "EE", confirmationStatus: "signed_received", approvalStatus: null, amountReceived: "5000" })).toBe(true);
    });

    it("VFH events need amount + signed confirmation AND approval received", () => {
      expect(canConfirm({ eventType: "VFH", confirmationStatus: "signed_received", approvalStatus: null, amountReceived: "5000" })).toBe(false);
      expect(canConfirm({ eventType: "VFH", confirmationStatus: "signed_received", approvalStatus: "received", amountReceived: "5000" })).toBe(true);
      expect(canConfirm({ eventType: "VFH", confirmationStatus: "signed_received", approvalStatus: "approved", amountReceived: "5000" })).toBe(true);
      expect(canConfirm({ eventType: "VFH", confirmationStatus: "none", approvalStatus: "received", amountReceived: "5000" })).toBe(false);
    });

    it("VFH events with approval Not Required confirm without an approval date", () => {
      expect(canConfirm({ eventType: "VFH", confirmationStatus: "signed_received", approvalStatus: "not_required", amountReceived: "5000" })).toBe(true);
    });

    it("blocks confirmation when amount received is missing (0 is allowed)", () => {
      expect(canConfirm({ eventType: "EE", confirmationStatus: "signed_received", approvalStatus: null, amountReceived: null })).toBe(false);
      expect(canConfirm({ eventType: "EE", confirmationStatus: "signed_received", approvalStatus: null, amountReceived: "" })).toBe(false);
      expect(canConfirm({ eventType: "EE", confirmationStatus: "signed_received", approvalStatus: null, amountReceived: undefined })).toBe(false);
      // A free / no-charge event records 0 — that satisfies the gate.
      expect(canConfirm({ eventType: "EE", confirmationStatus: "signed_received", approvalStatus: null, amountReceived: "0" })).toBe(true);
    });
  });
});
