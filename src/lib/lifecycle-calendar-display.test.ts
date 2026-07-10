import { describe, expect, it } from "vitest";
import { shouldShowLifecycleStepCountBadge } from "./lifecycle-calendar-display";

describe("shouldShowLifecycleStepCountBadge", () => {
  it("keeps the lifecycle month grid uncluttered", () => {
    expect(shouldShowLifecycleStepCountBadge()).toBe(false);
  });
});
