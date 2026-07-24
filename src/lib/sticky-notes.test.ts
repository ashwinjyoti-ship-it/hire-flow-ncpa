import { describe, expect, it } from "vitest";
import {
  autoStickyPosition,
  clampStickyPosition,
  currentEventId,
  stickyRotation,
} from "./sticky-notes";

describe("sticky-note layout helpers", () => {
  it("clamps positions and stacking order to the stored layout bounds", () => {
    expect(clampStickyPosition({ x: -0.4, y: 1.6, z_index: 100001.2 })).toEqual({
      x: 0,
      y: 1,
      z_index: 100000,
    });
  });

  it("auto-arranges notes into repeatable positions", () => {
    expect(autoStickyPosition(0)).toEqual({ x: 0.035, y: 0.04, z_index: 1 });
    expect(autoStickyPosition(1).x).toBeGreaterThan(autoStickyPosition(0).x);
    expect(autoStickyPosition(3).y).toBeGreaterThan(autoStickyPosition(0).y);
    expect(autoStickyPosition(9)).toEqual(autoStickyPosition(9));
  });

  it("derives a stable, restrained paper rotation", () => {
    expect(stickyRotation("note_example")).toBe(stickyRotation("note_example"));
    expect(Math.abs(stickyRotation("note_example"))).toBeLessThanOrEqual(1.5);
  });

  it("detects current event routes without treating the new-event form as context", () => {
    expect(currentEventId("/events/evt_123")).toBe("evt_123");
    expect(currentEventId("/events/evt_123/edit")).toBe("evt_123");
    expect(currentEventId("/events/evt_123/meeting")).toBe("evt_123");
    expect(currentEventId("/events/new")).toBeNull();
    expect(currentEventId("/calendar")).toBeNull();
  });
});
