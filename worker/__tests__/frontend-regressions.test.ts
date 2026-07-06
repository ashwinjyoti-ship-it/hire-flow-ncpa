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
    expect(source).toContain("Next step:");
    expect(source).toContain("LifecycleTrack");
    expect(source).toContain("Confirm decision");
    expect(source).toContain("Regret");
  });

  it("keeps notification flyout above routed page controls", () => {
    const source = readFileSync(resolve(root, "src/components/shell/Topbar.tsx"), "utf8");

    expect(source).toContain("relative z-50");
    expect(source).toContain("z-[70]");
  });

  it("keeps calendar focused on activity and lifecycle views", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");
    const dashboard = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(calendar).not.toContain("view=list");
    expect(calendar).not.toContain("EventsListView");
    expect(calendar).not.toContain('"venue", "lifecycle"');
    expect(calendar).toContain('requestedView === "show" ? "show" : "lifecycle"');
    expect(calendar).toContain('(["lifecycle", "show"] as const)');
    expect(calendar).not.toContain('"week"');
    expect(calendar).not.toContain('"day"');
    expect(calendar).toContain("const VenueTimeline");
    expect(dashboard).not.toContain("view=list");
    expect(calendar).toContain("lifecycle");
  });

  it("keeps task command cards collapsible by default", () => {
    const source = readFileSync(resolve(root, "src/pages/TasksPage.tsx"), "utf8");

    expect(source).toContain("aria-expanded");
    expect(source).toContain("Expand");
    expect(source).toContain("Collapse");
  });
});
