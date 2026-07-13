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

  it("persists venue and schedule edits instead of stripping them from the update payload", () => {
    const source = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");
    const routes = readFileSync(resolve(root, "worker/routes/events.ts"), "utf8");

    expect(source).toContain("await apiPut(`/events/${id}`, payload)");
    expect(source).not.toContain("venue_bookings: _vb");
    expect(source).toContain("setForm((f) => ({");
    expect(source).toContain("with_ac_minutes: withMin");
    expect(routes).toContain("venueBookingSyncStatements");
    expect(routes).toContain("db.batch([updateEvent, ...venueWrites])");
    expect(routes).toContain("UPDATE schedule_entries");
    expect(routes).toContain("parseScheduleJson");
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

  it("offers event record deletion while preserving organisation and POC details", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("Delete Record");
    expect(source).toContain("Keep organisation and POC details");
    expect(source).toContain("keep_org_details: keepOrgDetails");
    expect(source).toContain("event.archive");
    expect(source).toContain("useNavigate");
  });

  it("keeps lifecycle decision notes visible in activity", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("note: args.note");
    expect(source).toContain("formatActivityDetail");
    expect(source).toContain("Lifecycle note");
  });

  it("warns on post-show operational dates without generic reopen controls", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("getPostShowDateWarning");
    expect(source).toContain('role="alert"');
    expect(source).not.toContain('item.status === "completed" ? "Reopen"');
  });

  it("shows event type on the detail page with normalized fallback formatting", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("function formatEventType");
    expect(source).toContain('case "FE":');
    expect(source).toContain('return "Free Event";');
    expect(source).toContain('<SummaryItem label="Type" value={formatEventType(e.event_type)} />');
  });

  it("keeps notification flyout above routed page controls", () => {
    const source = readFileSync(resolve(root, "src/components/shell/Topbar.tsx"), "utf8");

    expect(source).toContain("sticky top-0 z-50");
    expect(source).toContain("z-[70]");
  });

  it("wires the topbar global search to organisations and events", () => {
    const source = readFileSync(resolve(root, "src/components/shell/Topbar.tsx"), "utf8");

    expect(source).toContain("function GlobalSearch");
    expect(source).toContain("/organisations?q=");
    expect(source).toContain("/events?q=");
    expect(source).toContain("View on calendar");
    expect(source).toContain("submitSearch");
  });

  it("persists calendar filters into the URL for shareable deep links", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("setSearchParams(next, { replace: true })");
    expect(calendar).toContain('next.set("view", view)');
    expect(calendar).toContain('searchParams.get("q") ?? ""');
    expect(calendar).toContain("function setFilter");
    expect(calendar).toContain("Filter");
    expect(calendar).toContain('onChange={(v) => setFilter("status", v)}');
  });

  it("keeps calendar focused on activity and lifecycle views", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");
    const dashboard = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(calendar).not.toContain("view=list");
    expect(calendar).not.toContain("EventsListView");
    expect(calendar).not.toContain('"venue", "lifecycle"');
    expect(calendar).toContain('searchParams.get("view") === "show" ? "show" : "lifecycle"');
    expect(calendar).toContain('(["lifecycle", "show"] as const)');
    expect(calendar).not.toContain('"week"');
    expect(calendar).not.toContain('"day"');
    expect(calendar).toContain("const VenueTimeline");
    expect(dashboard).not.toContain("view=list");
    expect(calendar).toContain("lifecycle");
  });

  it("reads calendar filters from the URL and jumps to the matching month on search", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("useEffect");
    expect(calendar).toContain("function dateFromParam");
    expect(calendar).toContain("Number.isNaN(date.getTime())");
    expect(calendar).toContain("function setView(nextView: View)");
    expect(calendar).toContain("dateFromParam(searchParams.get(\"from\"))");
    expect(calendar).toContain("searchParams.get(\"status\") ?? \"\"");
    expect(calendar).toContain("URL is the single source of truth");
    expect(calendar).toContain("/events?q=");
    expect(calendar).toContain("params.set(\"from\", from)");
  });

  it("preserves the active calendar view when submitting topbar search", () => {
    const source = readFileSync(resolve(root, "src/components/shell/Topbar.tsx"), "utf8");

    expect(source).toContain("const onCalendar = location.pathname === \"/calendar\"");
    expect(source).toContain("const view = onCalendar ? calendarView : \"lifecycle\"");
    expect(source).toContain('navigate(`/calendar?view=${view}&q=${encodeURIComponent(term)}&from=${from}`)');
    expect(source).toContain('View on ${calendarLabel}');
    expect(source).toContain('new URLSearchParams(location.search).get("q") ?? ""');
  });

  it("keeps page-level calendar filters collapsed behind one filter menu", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("<details");
    expect(calendar).toContain("activeFilterCount");
    expect(calendar).toContain('label="Status"');
    expect(calendar).toContain('label="Venue"');
    expect(calendar).not.toContain('placeholder={view === "show" ? "Search show calendar…" : "Search lifecycle…"}');
    expect(calendar).not.toContain('aria-label={view === "show" ? "Search show calendar" : "Search lifecycle calendar"}');
  });

  it("keeps dashboard summary cards as static counts while calendar destination is undecided", () => {
    const dashboard = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(dashboard).toContain("function SummaryCard({ label, value, status }");
    expect(dashboard).not.toContain("href={getLifecycleCalendarHref");
    expect(dashboard).not.toContain("href={getConfirmedShowCalendarHref");
    expect(dashboard).not.toContain("<Link to={href}");
  });

  it("keeps calendar month prominent without a today shortcut", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("{title}");
    expect(calendar).toContain("This month");
    expect(calendar).not.toContain("Jump to today");
  });

  it("draws complete Sunday-to-Saturday month rows without loading adjacent-month entries", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("function calendarCellsForMonth");
    expect(calendar).toContain("type MonthCell = { date: Date; key: string; inCurrentMonth: boolean }");
    expect(calendar).toContain("const entries = inCurrentMonth ? byDate[key] ?? [] : []");
    expect(calendar).toContain("text-ink-overflow");
    expect(calendar).not.toContain("date: Date | null");
  });

  it("keeps show calendar details separate from lifecycle record navigation", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("ShowCalendarDetailPanel");
    expect(calendar).toContain("View show details");
    expect(calendar).toContain("Sound Call Time");
    expect(calendar).toContain("Light Call Time");
    expect(calendar).toContain("House Seats");
    expect(calendar).toContain("event_requirements");
    expect(calendar).toContain("to={`/events/${entry.event_id}/edit`}");
    expect(calendar).toContain("View show details");
    expect(calendar).toContain("with_ac_start");
    expect(calendar).not.toContain("Open Record");
    expect(calendar).not.toContain("Show notes");
    expect(calendar).not.toContain("formatShowDetailValue");
    expect(calendar).not.toContain("tab=venues");
    expect(calendar).not.toContain("Open full record →");
  });

  it("lets lifecycle calendar open overflowed day entries in a dedicated panel", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("LifecycleOverflowPanel");
    expect(calendar).toContain("setLifecycleOverflow");
    expect(calendar).toContain("onOpenOverflow");
    expect(calendar).toContain("View all lifecycle records");
    expect(calendar).toContain("entries.slice(5)");
  });

  it("keeps missing call-time fields on the new event form", () => {
    const edit = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(edit).toContain('Field label="Sound Call Time"');
    expect(edit).toContain('setReq("sound_call_time"');
    expect(edit).toContain('Field label="Light Requirements"');
    expect(edit).toContain('setReq("light"');
    expect(edit).toContain('Field label="Light Call Time"');
    expect(edit).toContain('setReq("light_call_time"');
  });

  it("shows owner contact in the show calendar detail drawer", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("event_owner_email");
    expect(calendar).toContain('label="Owner contact"');
  });

  it("warns about possible duplicate events before save", () => {
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(eventForm).toContain('queryKey: ["event-duplicates"');
    expect(eventForm).toContain('apiGet<DuplicateCheckResponse>(`/events/duplicates?${duplicateQuery.toString()}`)');
    expect(eventForm).toContain('venues: selectedDuplicateVenues.join("|")');
    expect(eventForm).toContain("Possible duplicate");
    expect(eventForm).toContain("same organisation and start date");
    expect(eventForm).toContain("const hasDuplicateWarning = duplicates.length > 0");
    expect(eventForm).toContain("canCreateEvent(form) && !hasDuplicateWarning");
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
    expect(source).toContain("ChecklistProgress");
    expect(source).toContain("overallCompletion");
    expect(source).toContain("% complete");
  });

  it("keeps stale lifecycle tasks out of dashboard attention", () => {
    const source = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(source).toContain("isDashboardActionableTask");
    expect(source).toContain("STALE_CONFIRMED_TASK_RULES");
  });

  it("keeps by event visible as the default task view", () => {
    const source = readFileSync(resolve(root, "src/pages/TasksPage.tsx"), "utf8");

    expect(source).toContain('cards: "By event"');
    expect(source).toContain('return "cards";');
  });

  it("lets By event select the card view explicitly", () => {
    const source = readFileSync(resolve(root, "src/pages/TasksPage.tsx"), "utf8");

    expect(source).toContain('params.set("view", next)');
    expect(source).not.toContain('if (next === "cards") params.delete("view")');
  });

  it("does not show task status filter tabs", () => {
    const source = readFileSync(resolve(root, "src/pages/TasksPage.tsx"), "utf8");

    expect(source).not.toContain("TASK_STATUS_FILTERS");
    expect(source).not.toContain("setStatus");
    expect(source).not.toContain('{ value: "active", label: "To do" }');
    expect(source).not.toContain('{ value: "in_progress", label: "In progress" }');
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
    expect(settings).toContain("Check List Intervals");
    expect(settings).toContain("ChecklistIntervalsSection");
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

  it("shows the organisation name on the review step instead of the raw id", () => {
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");
    const review = readFileSync(resolve(root, "src/lib/event-review.ts"), "utf8");

    expect(eventForm).toContain("const reviewOrganisationName");
    expect(review).toContain('pushItem("Organisation", organisationName)');
    expect(eventForm).toContain("resolvedOrg?.organisation?.name");
  });

  it("normalises legacy event type values so the selector stays selected", () => {
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(eventForm).toContain("const EVENT_TYPE_OPTIONS");
    expect(eventForm).toContain("function normaliseEventType");
    expect(eventForm).toContain('case "FE":');
    expect(eventForm).toContain('return "Free Event";');
    expect(eventForm).toContain("EVENT_TYPE_OPTIONS.map");
  });

  it("builds the review step from filled values instead of fixed blank rows", () => {
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");
    const review = readFileSync(resolve(root, "src/lib/event-review.ts"), "utf8");

    expect(eventForm).toContain("buildReviewItems(form, reviewOrganisationName");
    expect(review).toContain("Object.entries(requirements)");
    expect(review).toContain("bookings.forEach((venueBooking, venueIndex)");
    expect(review).toContain("formatScheduleSummary");
    expect(eventForm).toContain("reviewItems.map((item) =>");
    expect(eventForm).not.toContain('<ReviewItem label="Program Officer" value={form.program_officer} />');
    expect(eventForm).not.toContain('<ReviewItem label="Owner" value={form.event_owner} />');
    // Regression: do not early-return into a venue-1-only six-box summary.
    expect(eventForm).not.toContain("return buildEventReviewItems(form, organisationName)");
    expect(review).not.toContain("const firstBooking = form.venue_bookings[0]");
  });

  it("hydrates organisation type only once per resolved organisation so manual picks do not reset", () => {
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(eventForm).toContain("const hydratedOrgIdRef = useRef<string | null>(null)");
    expect(eventForm).toContain("if (!org || hydratedOrgIdRef.current === org.id) return;");
    expect(eventForm).not.toContain("}, [resolvedOrg, onSelectOrganisation]);");
  });

  it("centres review labels and values instead of right-justifying them", () => {
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(eventForm).toContain('className="grid gap-3 text-sm md:grid-cols-2"');
    expect(eventForm).toContain('className="flex min-h-24 h-full flex-col items-center justify-center rounded-xl');
    expect(eventForm).toContain('className="mt-2 w-full max-w-full whitespace-normal break-words text-center font-medium leading-relaxed text-ink-primary etched-deep"');
    expect(eventForm).not.toContain('className="flex justify-between border-b border-ink-muted/10 pb-2"');
  });

  it("lets review card values wrap horizontally for multi-venue and multi-show content", () => {
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(eventForm).toContain('className="flex min-h-24 h-full flex-col items-center justify-center rounded-xl');
    expect(eventForm).toContain('className="mt-2 w-full max-w-full whitespace-normal break-words text-center font-medium leading-relaxed text-ink-primary etched-deep"');
  });

  it("keeps carved select fields visually embedded on tablet browsers", () => {
    const css = readFileSync(resolve(root, "src/index.css"), "utf8");
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(css).toContain("select.input");
    expect(css).toContain("appearance: none");
    expect(css).toContain("border: 1px solid rgba(90, 88, 82, 0.16)");
    expect(eventForm).not.toContain("<style>{`.carved.input");
  });

  it("keeps MoM-related event form fields for stage setup, interval, and officer contact", () => {
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(eventForm).toContain('Field label="Stage Setup"');
    expect(eventForm).toContain('setReq("stage_setup"');
    expect(eventForm).toContain('Field label="Program Officer Contact"');
    expect(eventForm).toContain('setReq("program_officer_phone"');
    expect(eventForm).toContain('Field label="Interval (conditional)"');
    expect(eventForm).toContain('setReq("interval"');
    expect(eventForm).toContain('Field label="Digital Standee — notes"');
    expect(eventForm).toContain('Field label="Car Display — notes"');
  });

  it("exposes Generate MoM on the event lifecycle panel", () => {
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(detail).toContain("Generate MoM");
    expect(detail).toContain("onGenerateMom");
    expect(detail).toContain("buildMomDocument");
    expect(detail).toContain("Customised information");
    expect(detail).toContain("Copy Text");
  });

  it("exposes Print and Export to PDF for the filled event form on the lifecycle panel", () => {
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    const helper = readFileSync(resolve(root, "src/lib/event-form-print.ts"), "utf8");

    expect(detail).toContain("onPrintEventForm");
    expect(detail).toContain("onExportEventFormPdf");
    expect(detail).toContain("openEventFormPrintable");
    expect(detail).toContain("Export to PDF");
    expect(detail).toContain("Event form");
    expect(helper).toContain("buildEventFormHtml");
    expect(helper).toContain("No documents uploaded.");
    expect(helper).toContain("Sign-off");
  });
});
