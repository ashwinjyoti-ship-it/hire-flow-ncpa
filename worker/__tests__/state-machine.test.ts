import { describe, it, expect } from "vitest";
import { canTransition, requiresOverride, canConfirm, requiresApproval } from "../lib/state-machine";

describe("Event state machine", () => {
  describe("valid transitions", () => {
    it("allows inquiry → availability_check", () => {
      expect(canTransition("inquiry", "availability_check")).toBe(true);
    });

    it("allows the primary happy path", () => {
      expect(canTransition("draft", "inquiry")).toBe(true);
      expect(canTransition("inquiry", "awaiting_approval")).toBe(true);
      expect(canTransition("awaiting_approval", "approved")).toBe(true);
      expect(canTransition("approved", "confirmed")).toBe(true);
      expect(canTransition("confirmed", "in_progress")).toBe(true);
      expect(canTransition("in_progress", "completed")).toBe(true);
      expect(canTransition("completed", "closed")).toBe(true);
    });

    it("allows waitlisted → confirmed (skip approval where permitted)", () => {
      expect(canTransition("waitlisted", "confirmed")).toBe(true);
    });

    it("allows confirmed → cancelled", () => {
      expect(canTransition("confirmed", "cancelled")).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("blocks closed → anything (terminal)", () => {
      expect(canTransition("closed", "in_progress")).toBe(false);
      expect(canTransition("closed", "confirmed")).toBe(false);
      expect(canTransition("closed", "inquiry")).toBe(false);
    });

    it("blocks skipping ahead from inquiry to completed", () => {
      expect(canTransition("inquiry", "completed")).toBe(false);
      expect(canTransition("inquiry", "closed")).toBe(false);
    });

    it("blocks completed → in_progress (no backwards from terminal-ish)", () => {
      expect(canTransition("completed", "in_progress")).toBe(false);
    });
  });

  describe("override requirements", () => {
    it("requires override to cancel an in-progress event", () => {
      expect(requiresOverride("in_progress", "cancelled")).toBe(true);
    });

    it("requires override to cancel a confirmed event", () => {
      expect(requiresOverride("confirmed", "cancelled")).toBe(true);
    });

    it("requires override to reopen a cancelled event", () => {
      expect(requiresOverride("cancelled", "tentative")).toBe(true);
    });

    it("does not require override for a normal forward transition", () => {
      expect(requiresOverride("inquiry", "awaiting_approval")).toBe(false);
      expect(requiresOverride("approved", "confirmed")).toBe(false);
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

    it("non-VFH events can confirm with signed confirmation alone", () => {
      expect(canConfirm({ eventType: "EE", confirmationStatus: "signed_received", approvalStatus: null })).toBe(true);
    });

    it("VFH events need both signed confirmation AND approval received", () => {
      expect(canConfirm({ eventType: "VFH", confirmationStatus: "signed_received", approvalStatus: null })).toBe(false);
      expect(canConfirm({ eventType: "VFH", confirmationStatus: "signed_received", approvalStatus: "received" })).toBe(true);
      expect(canConfirm({ eventType: "VFH", confirmationStatus: "signed_received", approvalStatus: "approved" })).toBe(true);
      expect(canConfirm({ eventType: "VFH", confirmationStatus: "none", approvalStatus: "received" })).toBe(false);
    });
  });
});
