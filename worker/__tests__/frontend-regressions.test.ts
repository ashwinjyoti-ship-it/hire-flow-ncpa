import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

describe("frontend regression guards", () => {
  it("keeps event create navigation tied to the mutation result", () => {
    const source = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(source).not.toContain("let lastCreatedId");
    expect(source).toContain("onSuccess: (createdId)");
  });

  it("loads persisted MFA status instead of hardcoding unenrolled", () => {
    const source = readFileSync(resolve(root, "src/pages/ProfilePage.tsx"), "utf8");

    expect(source).toContain("/api/auth/mfa/status");
    expect(source).not.toContain("Infer MFA status via a dedicated endpoint");
  });

  it("keeps lifecycle decisions on the event detail page", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("LifecyclePanel");
    expect(source).toContain("Suggested:");
    expect(source).toContain("Confirm decision");
    expect(source).toContain("Regret");
  });
});
