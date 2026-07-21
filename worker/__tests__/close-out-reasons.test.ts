import { describe, expect, it } from "vitest";
import {
  closeOutReasonLabel,
  closeOutReasonsForEventType,
  validateCloseOutReasonInput,
} from "../lib/close-out-reasons";

describe("close-out reasons", () => {
  it("omits not approved for non-VFH events", () => {
    expect(closeOutReasonsForEventType("Conference")).not.toContain("not_approved");
    expect(closeOutReasonsForEventType("VFH")).toContain("not_approved");
  });

  it("requires note when other is selected", () => {
    expect(validateCloseOutReasonInput({ reason: "other", note: "", eventType: "VFH" }).ok).toBe(false);
    const ok = validateCloseOutReasonInput({ reason: "other", note: "Client chose another hall", eventType: "VFH" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.note).toBe("Client chose another hall");
  });

  it("allows optional note for structured reasons", () => {
    const ok = validateCloseOutReasonInput({ reason: "cost", note: "Quoted 20% over budget", eventType: "VFH" });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.reason).toBe("cost");
      expect(ok.note).toBe("Quoted 20% over budget");
    }
  });

  it("maps known codes to labels and preserves legacy free text", () => {
    expect(closeOutReasonLabel("cost")).toBe("Cost");
    expect(closeOutReasonLabel("Legacy free text")).toBe("Legacy free text");
  });
});
