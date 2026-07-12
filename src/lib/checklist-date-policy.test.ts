import { describe, expect, it } from "vitest";
import { getPostShowDateWarning } from "../../worker/lib/checklist-date-policy";

describe("checklist date policy", () => {
  it("rejects a technical meeting after the final show", () => {
    expect(getPostShowDateWarning("technical_meeting_date", "2026-07-10", "2026-07-01"))
      .toBe("The date entered is post-show. Choose 2026-07-01 or an earlier date.");
  });

  it("allows a technical meeting on or before the final show", () => {
    expect(getPostShowDateWarning("technical_meeting_date", "2026-07-01", "2026-07-01")).toBeNull();
    expect(getPostShowDateWarning("technical_meeting_date", "2026-06-09", "2026-07-01")).toBeNull();
  });

  it("allows legitimate post-event workflow dates", () => {
    expect(getPostShowDateWarning("dismantling_date", "2026-07-02", "2026-07-01")).toBeNull();
    expect(getPostShowDateWarning("feedback_sent", "2026-07-02", "2026-07-01")).toBeNull();
    expect(getPostShowDateWarning("file_sent_to_accounts", "2026-07-02", "2026-07-01")).toBeNull();
  });
});
