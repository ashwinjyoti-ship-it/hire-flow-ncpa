import { describe, expect, it } from "vitest";
import { EVENT_CLOSE_OUT_COPY } from "./event-close-out-copy";

describe("event close-out copy", () => {
  it("documents regret, cancel, and delete", () => {
    expect(EVENT_CLOSE_OUT_COPY.regret).toMatch(/before it is confirmed/i);
    expect(EVENT_CLOSE_OUT_COPY.cancel).toMatch(/confirmed booking/i);
    expect(EVENT_CLOSE_OUT_COPY.delete).toMatch(/archived/i);
  });
});
