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

  it("hydrates the edit form from the existing event (not an empty form)", () => {
    // Regression: clicking Edit from the event detail page (reachable from both
    // the lifecycle and show calendars) used to open a blank form because the
    // component never fetched the event being edited.
    const source = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(source).toContain('queryKey: ["event", id, "edit"]');
    expect(source).toContain("apiGet<EventDetailResponse>(`/events/${id}`)");
    expect(source).toContain("enabled: isEdit");
    // The hydrated guard prevents the empty form flashing before data lands.
    expect(source).toContain("if (isEdit && (existingLoading || !hydrated))");
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
    expect(source).toContain("useSearchParams");
    expect(source).toContain("parseEventDetailTab");
    expect(source).toContain("canShowStatusActions={tab === \"operations\"}");
    expect(source).toContain("Open Operations to change lifecycle status");
  });

  it("keeps lifecycle decision notes visible in activity", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("note: args.note");
    expect(source).toContain("formatActivityDetail");
    expect(source).toContain("Lifecycle note");
  });

  it("keeps notification flyout above routed page controls", () => {
    const source = readFileSync(resolve(root, "src/components/shell/Topbar.tsx"), "utf8");

    expect(source).toContain("sticky top-0 z-50");
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

  it("keeps calendar month prominent without a today shortcut", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("{title}");
    expect(calendar).toContain("This month");
    expect(calendar).not.toContain("Jump to today");
  });

  it("keeps dashboard task rows tied to a specific event", () => {
    const dashboard = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(dashboard).toContain("getTaskWorkLink(task)");
    expect(dashboard).toContain("task.event_title");
    expect(dashboard).toContain("eventDisplayName(task.event_title, task.organisation_name)");
  });

  it("keeps dashboard lifecycle rows tied to a specific event", () => {
    const dashboard = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(dashboard).toContain("e.organisation_name && e.title !== e.organisation_name");
    expect(dashboard).toContain("eventDisplayName(e.title, e.organisation_name)");
    expect(dashboard).toContain("function eventDisplayName");
    expect(dashboard).toContain("getEventOperationsLink(e.event_id)");
  });

  it("keeps task command cards collapsible by default", () => {
    const source = readFileSync(resolve(root, "src/pages/TasksPage.tsx"), "utf8");

    expect(source).toContain("aria-expanded");
    expect(source).toContain("Expand");
    expect(source).toContain("Collapse");
  });

  it("keeps stale lifecycle tasks out of dashboard attention", () => {
    const source = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(source).toContain("isDashboardActionableTask");
    expect(source).toContain("STALE_CONFIRMED_TASK_RULES");
  });

  it("keeps work lanes visible as the default task view", () => {
    const source = readFileSync(resolve(root, "src/pages/TasksPage.tsx"), "utf8");

    expect(source).toContain('lanes: "Work lanes"');
    expect(source).toContain('return "lanes";');
  });

  it("keeps task queues as links to event work instead of completion controls", () => {
    const source = readFileSync(resolve(root, "src/pages/TasksPage.tsx"), "utf8");

    expect(source).toContain("getTaskWorkLink(task)");
    expect(source).toContain("Open work");
    expect(source).not.toContain("updateTask.mutate");
    expect(source).not.toContain("apiPatch(`/tasks/");
  });

  it("manages event owners as real accounts (not a free-text master list)", () => {
    // Phase 8a: event owners are now logins. handled_by is no longer a free-text
    // master list in Settings — it's managed via the EventOwnersSection, which
    // creates a users row + dropdown option together. Caterer/decorator remain
    // free-text master lists.
    const settings = readFileSync(resolve(root, "src/pages/SettingsPage.tsx"), "utf8");
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    // Phase 8b: the event form now sources its owner dropdown from real accounts
    // (/users) and sets event_owner_id, not the free-text handled_by lookup.
    expect(eventForm).toContain('queryKey: ["users"]');
    expect(eventForm).toContain("apiGet(\"/users\")");
    expect(eventForm).toContain("event_owner_id");
    expect(eventForm).not.toContain("lookups?.lookups.handled_by");
    // Settings must NOT present handled_by as a free-text master list anymore.
    expect(settings).not.toContain('listKeys={["handled_by", "caterer", "decorator"]}');
    expect(settings).toContain('listKeys={["caterer", "decorator"]}');
    expect(settings).toContain("EventOwnersSection");
  });

  it("keeps event form navigation at both top and bottom", () => {
    const source = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect((source.match(/<FormNavigation/g) ?? []).length).toBe(2);
    expect(source).toContain("function FormNavigation");
  });

  it("captures organisation type when creating an organisation from the event form", () => {
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");
    const orgTypes = readFileSync(resolve(root, "src/components/orgs/types.ts"), "utf8");

    expect(eventForm).toContain("Organisation Type");
    expect(eventForm).toContain("org_type: newOrganisationType || null");
    expect(eventForm).toContain("ORG_TYPES.map");
    expect(orgTypes).toContain("Cooperative");
  });

  it("keeps carved select fields visually embedded on tablet browsers", () => {
    const css = readFileSync(resolve(root, "src/index.css"), "utf8");
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(css).toContain("select.input");
    expect(css).toContain("appearance: none");
    expect(css).toContain("border: 1px solid rgba(90, 88, 82, 0.16)");
    expect(eventForm).not.toContain("<style>{`.carved.input");
  });
});
