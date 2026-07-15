import { describe, expect, it } from "vitest";
import { nextAppMainScrollTop } from "./scroll-app-main";

describe("nextAppMainScrollTop", () => {
  it("aligns the target to the start of the main pane", () => {
    expect(
      nextAppMainScrollTop({
        mainTop: 100,
        mainHeight: 400,
        mainScrollTop: 200,
        targetTop: 300,
        targetHeight: 200,
        align: "start",
      }),
    ).toBe(400);
  });

  it("centers the target in the main pane", () => {
    expect(
      nextAppMainScrollTop({
        mainTop: 100,
        mainHeight: 400,
        mainScrollTop: 0,
        targetTop: 500,
        targetHeight: 100,
        align: "center",
      }),
    ).toBe(250);
  });

  it("never scrolls above the top", () => {
    expect(
      nextAppMainScrollTop({
        mainTop: 100,
        mainHeight: 400,
        mainScrollTop: 10,
        targetTop: 50,
        targetHeight: 40,
        align: "start",
      }),
    ).toBe(0);
  });
});
