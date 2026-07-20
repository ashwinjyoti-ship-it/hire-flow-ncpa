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
    expect(source).toContain("canShowStatusActions={activeWorkflowPhase === \"confirm\"}");
    expect(source).toContain("Status changes are available while Confirm is the active workflow");
    expect(source).toContain("forwardMilestoneButtonClass");
    // Blocked forward milestones use awaiting-approval amber, not confirmed-green.
    expect(source).toContain("bg-status-awaitingApproval/15");
    expect(source).toContain("action.allowed");
    expect(source).not.toContain("bg-status-confirmed/15 text-sage-text ring-1 ring-status-confirmed/25");
    // Continue/Advance stays disabled until blockers clear; blocker name link is the deep-link.
    expect(source).toContain("disabled={!nextAction}");
    expect(source).toContain("bg-marble-shadow/45 text-ink-muted");
    expect(source).not.toContain("disabled={!nextAction && !visibleBlockerTarget}");
    // One blocker at a time — do not dump the full blocker list in the panel.
    expect(source).toContain("selectNextLifecycleBlocker");
    expect(source).toContain("currentMilestoneTrackClass");
    expect(source).toContain("getEventStatusSurface");
  });

  it("labels event tasks as system-generated and separates completed history", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    expect(source).toContain("System-generated");
    expect(source).not.toContain('task_type === "automatic" ? "Automatic"');
    expect(source).toContain("Completed ({completedTasks.length})");
    expect(source).toContain("No open tasks.");
  });

  it("uses the established status palette for event-form readiness", () => {
    const source = readFileSync(resolve(root, "src/components/EventReadinessPanel.tsx"), "utf8");
    const detailPage = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("bg-status-cancelled/10");
    expect(source).toContain("bg-status-awaitingApproval/10");
    expect(source).toContain("bg-status-tentative/10");
    expect(source).toContain("bg-status-confirmed/10");
    expect(source).not.toMatch(/bg-(red|orange|amber|emerald)-/);
    expect(source).toContain("Still needed");
    expect(source).toContain("Venues &amp; schedule");
    expect(source).toContain("Fix schedule");
    expect(source).toContain("setActivityLabels");
    expect(source).toContain("section.setLabels");
    expect(source).toContain("VENUES_SCHEDULE_READINESS_KEY");
    expect(detailPage).toContain("VENUES_SCHEDULE_ANCHOR_ID");
    expect(detailPage).toContain("scrollAppMainToElement(el, \"start\", \"smooth\")");
    expect(source).toContain("section.missingLabels.map");
    expect(source).not.toContain("section.missingLabels.slice(0, 2)");
    expect(source).toContain("section.missingKeys[index]");
    expect(source).toContain("&field=");
    expect(source).toContain("Open {section.label} section");
    // Confirmation gates belong in Lifecycle — not mixed into form readiness.
    expect(source).not.toContain("Before confirmation");
    expect(source).not.toContain("beforeConfirmationBlockers");
  });

  it("gives every readiness item an exact event-form field target", () => {
    const readiness = readFileSync(resolve(root, "worker/lib/event-readiness.ts"), "utf8");
    const fields = readFileSync(resolve(root, "src/components/event-form/RequirementsFields.tsx"), "utf8");
    const staticKeys = Array.from(readiness.matchAll(/(?:decision|detail)\("([^"]+)"/g), (match) => match[1]);

    for (const key of staticKeys) expect(fields).toContain(`fieldKey="${key}"`);
    expect(fields).toContain('id={`requirement-field-${requiredKey}`}');
    expect(fields).toContain('id={`requirement-field-${paxKey}`}');
  });

  it("offers event record deletion while preserving organisation and POC details", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("Delete Record");
    expect(source).toContain("Keep organisation and POC details");
    expect(source).toContain("keep_org_details: keepOrgDetails");
    expect(source).toContain("event.archive");
    expect(source).toContain("useNavigate");
  });

  it("keeps lifecycle decision notes on status transitions", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(source).toContain("note: args.note");
  });

  it("shows venues and schedule before documents and omits conflict/activity tabs", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    const venuesIdx = source.indexOf('["venues", venuesAndScheduleTabLabel(');
    const documentsIdx = source.indexOf('["documents", `Documents');
    expect(venuesIdx).toBeGreaterThan(-1);
    expect(documentsIdx).toBeGreaterThan(-1);
    expect(venuesIdx).toBeLessThan(documentsIdx);
    expect(source).not.toContain('["conflicts"');
    expect(source).not.toContain('["activity", "Activity"]');
    expect(source).toContain("Schedule");
    expect(source).toContain("With AC");
    expect(source).toContain("venues booked");
    expect(source).toContain("getDefaultExpandedVenueKeys");
    expect(source).toContain("carved-btn border border-ink-muted/25 bg-neutral-btn");
    expect(source).not.toContain("Sound, light &amp; staffing");
    expect(source).not.toContain("Call times");
  });

  it("drops overview tab and shows completion inside lifecycle", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    expect(source).not.toContain('["overview", "Overview"]');
    expect(source).toContain('parseEventDetailTab(searchParams.get("tab")) ?? "tasks"');
    expect(source).toContain("LifecycleWorkflowStack");
    expect(source).toContain("completion={{");
    expect(source).toContain("<h3 className=\"mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched\">Completion</h3>");
  });

  it("keeps lifecycle confirm in accordion and surfaces accounts as its own tab", () => {
    const source = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    const stack = readFileSync(resolve(root, "src/components/LifecycleWorkflowStack.tsx"), "utf8");
    expect(source).toContain('["tasks", `Tasks');
    expect(source).toContain("Feedback/Accounts");
    expect(source).toContain("Post Event");
    expect(source).not.toContain('["operations", "Operations"]');
    expect(source).toContain("AccountsView");
    expect(source).toContain("Close file");
    expect(source).toContain("filterTasksForActiveWorkflow");
    expect(stack).not.toContain("accountsContent");
  });

  it("shows post-confirm ops and event readiness outside the Event prep accordion", () => {
    const stack = readFileSync(resolve(root, "src/components/LifecycleWorkflowStack.tsx"), "utf8");
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    expect(stack).toContain("postConfirmOpsContent");
    expect(stack).toContain("eventReadinessContent");
    expect(stack).toContain("PostConfirmPanel");
    expect(stack).toContain("postConfirmOpsComplete");
    expect(stack).toContain("morning after the final show");
    expect(stack).not.toContain('STACK_PHASES');
    expect(detail).toContain("postConfirmOpsContent={");
    expect(detail).toContain("eventReadinessContent={");
    expect(detail).toContain("eventPrepOpsSections");
    expect(detail).toContain("confirmSections");
    expect(detail).toContain("Ops actions");
    expect(detail).toContain('label="Ops actions"');
    expect(detail).toContain('label="Event form"');
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

  it("shows payment status in the event detail summary instead of signed confirmation", () => {
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    const routes = readFileSync(resolve(root, "worker/routes/events.ts"), "utf8");

    expect(detail).toContain('<SummaryItem label="Payment status" value={prettyState(e.payment_status)} />');
    expect(detail).not.toContain('<SummaryItem label="Signed confirmation"');
    expect(detail).toContain("payment_status: string | null;");
    expect(routes).toContain("field_key = 'payment_status'");
    expect(routes).toContain("payment_status: paymentStatusRow?.value ?? null");
  });

  it("deep-links POC blockers to the event form POC section", () => {
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    const edit = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");
    const pocFields = readFileSync(resolve(root, "src/components/event-form/PocFields.tsx"), "utf8");
    const blockerTargets = readFileSync(resolve(root, "src/lib/lifecycle-blocker-targets.ts"), "utf8");
    const operations = readFileSync(resolve(root, "worker/lib/operations.ts"), "utf8");

    expect(detail).toContain("resolveBlockerWorkHref");
    expect(blockerTargets).toContain("getEventPocEditLink(eventId)");
    expect(pocFields).toContain('id="requirement-poc"');
    expect(edit).toContain('section === "poc"');
    expect(edit).toContain("const requiredStep = isPocDeepLink ? 0 : 2");
    expect(operations).toContain("isChecklistFieldVisible");
    expect(operations).toContain('if (item.status === "not_applicable") continue');
    expect(operations).toContain("syncInstalmentDependentChecklist");
  });

  it("keeps notification flyout above routed page controls", () => {
    const topbar = readFileSync(resolve(root, "src/components/shell/Topbar.tsx"), "utf8");
    const shell = readFileSync(resolve(root, "src/components/shell/AppShell.tsx"), "utf8");

    expect(topbar).toContain("z-50");
    expect(topbar).toContain("z-[70]");
    expect(shell).toContain('id="app-main"');
    expect(shell).toContain("overflow-y-auto");
    expect(shell).toContain("h-dvh");
  });

  it("marks a single notification read by id without using read-all", () => {
    const topbar = readFileSync(resolve(root, "src/components/shell/Topbar.tsx"), "utf8");

    expect(topbar).toContain("markOne");
    expect(topbar).toContain("`/notifications/${id}/read`");
    expect(topbar).toContain("markOne.mutate(n.id)");
    expect(topbar).toContain("Mark as Read");
    expect(topbar).toContain("Mark all read");
    expect(topbar).toContain('/notifications/read-all');
  });

  it("scrolls Go to top inside #app-main and does not re-yank on checklist refetch", () => {
    const goToTop = readFileSync(resolve(root, "src/components/GoToTopButton.tsx"), "utf8");
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(goToTop).toContain("scrollAppMainToId");
    expect(goToTop).not.toContain("scrollIntoView");
    expect(detail).toContain('targetId="event-lifecycle"');
    expect(detail).toContain("scrolledToFieldRef");
    expect(detail).toContain("scrollAppMainToElement");
    expect(detail).toContain("onGoToTop={clearFocusedField}");
  });

  it("applies optimistic checklist updates via shared hook instead of full event refetch", () => {
    const hook = readFileSync(resolve(root, "src/lib/use-checklist-update.ts"), "utf8");
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");

    expect(hook).toContain("applyOptimisticChecklistUpdate");
    expect(hook).toContain("onMutate:");
    expect(hook).not.toContain("fetchFreshEventState");
    expect(detail).toContain("useChecklistUpdate");
    expect(detail).toContain("savingItemId={savingChecklistItemId}");
    expect(detail).not.toMatch(/checklistUpdate[\s\S]*fetchFreshEventState/);
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

  it("keeps dashboard summary metrics bounded to active operational work", () => {
    const dashboard = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(dashboard).toContain("Active enquiries");
    expect(dashboard).toContain("Awaiting confirmation");
    expect(dashboard).toContain('label="Confirmed"');
    expect(dashboard).toContain("Confirmed events remain counted through their start date");
    expect(dashboard).toContain("dashboardOperationalCounts");
    expect(dashboard).not.toContain('label="Regret"');
    expect(dashboard).not.toContain('label="Cancelled"');
    expect(dashboard).not.toContain("href={getLifecycleCalendarHref");
    expect(dashboard).not.toContain("href={getConfirmedShowCalendarHref");
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
    expect(calendar).toContain("Object.keys(venueReqs).length > 0");
    expect(calendar).toContain("to={`/events/${entry.event_id}/edit`}");
    expect(calendar).toContain("getEventOperationsLink(entry.event_id)");
    expect(calendar).toMatch(/>\s*Edit Checklist\s*</);
    expect(calendar).toMatch(/>\s*Edit Event Data\s*</);
    expect(calendar).toContain("View show details");
    expect(calendar).toContain("with_ac_start");
    expect(calendar).not.toContain("Open Record");
    expect(calendar).not.toContain("Show notes");
    expect(calendar).not.toContain("formatShowDetailValue");
    expect(calendar).not.toContain("tab=venues");
    expect(calendar).not.toContain("Open full record →");
  });

  it("routes status filters to the calendar that can show them", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("function calendarViewForStatus");
    expect(calendar).toContain('SHOW_CALENDAR_STATUSES.has(status) ? "show" : "lifecycle"');
    expect(calendar).toContain('if (key === "status")');
    expect(calendar).toContain("calendarViewForStatus(value.trim())");
    // Status menu lists pipeline + confirmed so choosing one can switch views.
    expect(calendar).toContain('.filter(([k]) => k !== "regret")');
    // Legend on Lifecycle still omits confirmed (those cards live on Show).
    expect(calendar).toContain('.filter(([key]) => key !== "confirmed" && key !== "regret")');
  });

  it("builds owner filter options from event-owner accounts", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain('queryKey: ["users"]');
    expect(calendar).toContain("u.is_event_owner");
    expect(calendar).toContain("ownerNames");
    expect(calendar).toContain("fromUsers.length > 0 ? [...fromUsers] : [...fromLookups]");
  });

  it("lets lifecycle calendar open overflowed day entries in a dedicated panel", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("CALENDAR_VISIBLE_EVENTS_PER_DAY = 3");
    expect(calendar).toContain("LifecycleOverflowPanel");
    expect(calendar).toContain("setLifecycleOverflow");
    expect(calendar).toContain("onOpenOverflow");
    expect(calendar).toContain("View all lifecycle records");
    expect(calendar).toContain("entries.slice(CALENDAR_VISIBLE_EVENTS_PER_DAY)");
  });

  it("caps show-calendar day cells and exposes every hidden event", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("ShowCalendarOverflowPanel");
    expect(calendar).toContain("setShowOverflow");
    expect(calendar).toContain("chips.slice(0, CALENDAR_VISIBLE_EVENTS_PER_DAY)");
    expect(calendar).toContain("hiddenChips.length");
    expect(calendar).toContain("View all show events");
    expect(calendar).toContain("h-[10rem]");
  });

  it("keeps missing call-time fields on the new event form", () => {
    const fields = readFileSync(resolve(root, "src/components/event-form/RequirementsFields.tsx"), "utf8");

    expect(fields).toContain('Field fieldKey="sound_call_time" label="Sound Call Time"');
    expect(fields).toContain('setReq("sound_call_time"');
    expect(fields).toContain('Field fieldKey="light" label="Light Requirements"');
    expect(fields).toContain('setReq("light"');
    expect(fields).toContain('Field fieldKey="light_call_time" label="Light Call Time"');
    expect(fields).toContain('setReq("light_call_time"');
  });

  it("shows owner contact in the show calendar detail drawer", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("event_owner_email");
    expect(calendar).toContain('label="Owner contact"');
  });

  it("shows stage and foyer setup in the show calendar detail drawer only when present", () => {
    const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

    expect(calendar).toContain("hasRequirementText(reqs.stage_setup)");
    expect(calendar).toContain('label="Stage Setup"');
    expect(calendar).toContain("hasRequirementText(reqs.foyer_setup)");
    expect(calendar).toContain('label="Foyer Setup"');
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

    expect(dashboard).toContain("entry.organisation_name && entry.title !== entry.organisation_name");
    expect(dashboard).toContain("eventDisplayName(entry.title, entry.organisation_name)");
    expect(dashboard).toContain('from "../lib/event-display"');
    expect(dashboard).toContain("pipelineDecisionHref(entry)");
  });

  it("separates pipeline decisions from event-grouped next actions", () => {
    const dashboard = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(dashboard).toContain("Pipeline Decisions");
    expect(dashboard).toContain("Next Actions");
    expect(dashboard).toContain("groupDashboardActions");
    expect(dashboard).toContain("groupPipelineDecisions");
    expect(dashboard).toContain("pipelineDecisionHref");
    expect(dashboard).toContain("group.count - 1");
    expect(dashboard).toContain("${group.count} open tasks");
    expect(dashboard).not.toContain("+{group.count - 1} more");
    expect(dashboard).toContain("matching");
    expect(dashboard).toContain("usablePipelineDate");
    expect(dashboard).toContain("DASHBOARD_VISIBLE_EVENTS = 5");
    expect(dashboard).toContain("DASHBOARD_LIST_MAX_HEIGHT");
    expect(dashboard).toContain("overflow-y-auto scroll-slim");
    expect(dashboard).toContain("overdueActionGroupCount");
    expect(dashboard).toContain("with overdue actions");
    expect(dashboard).toContain("daysOverdue === 1");
    expect(dashboard).not.toContain(">Overdue</span>");
    expect(dashboard).not.toContain("pipelineDecisionGroups.slice(0, 8)");
    expect(dashboard).not.toContain("actionGroups.slice(0, 8)");
    expect(dashboard).not.toContain("Lifecycle Queue");
    expect(dashboard).not.toContain("Work Needing Attention");
    expect(dashboard).not.toContain("POC Still Missing");
  });

  it("keeps task command cards collapsible by default", () => {
    const source = readFileSync(resolve(root, "src/pages/TasksPage.tsx"), "utf8");

    expect(source).toContain("aria-expanded");
    expect(source).toContain("Expand");
    expect(source).toContain("Collapse");
    expect(source).toContain("ChecklistProgress");
    expect(source).toContain("formReadiness");
    expect(source).toContain("% ready");
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
    expect(source).toContain("eventContextLines");
    expect(source).toContain("EventContextHeading");
    expect(source).toContain("organisationName");
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

  it("separates team-account event owners from programme-officer name+contact list", () => {
    // Event owners are logins (is_event_owner). Programme officers are a
    // name+contact master list (no login) under ProgrammeOfficersSection.
    // An owner may also be marked as PO (contact required) and syncs to that list.
    const settings = readFileSync(resolve(root, "src/pages/SettingsPage.tsx"), "utf8");
    const eventForm = readFileSync(resolve(root, "src/pages/EventEditPage.tsx"), "utf8");

    expect(eventForm).toContain('queryKey: ["users"]');
    expect(eventForm).toContain("apiGet(\"/users\")");
    expect(eventForm).toContain("event_owner_id");
    expect(eventForm).toContain("u.is_event_owner");
    expect(eventForm).toContain("lookups?.lookups.program_officer");
    expect(eventForm).not.toContain("lookups?.lookups.handled_by");
    expect(settings).not.toContain('listKeys={["handled_by", "caterer", "decorator"]}');
    expect(settings).toContain('listKeys={["caterer", "decorator"]}');
    expect(settings).toContain("TeamAccountsSection");
    expect(settings).toContain("ProgrammeOfficersSection");
    expect(settings).toContain("is_event_owner");
    expect(settings).toContain("Also programme officer");
    // Permission presets / checkbox editor stay in rbac backend — not in Settings UI.
    expect(settings).not.toContain("PERMISSION_PRESETS");
    expect(settings).not.toContain("PermissionEditor");
    expect(settings).not.toContain("Event manager");
    expect(settings).not.toContain("Full access");
    // Deactivated accounts stay out of the way in a collapsed subsection.
    expect(settings).toContain("Deactivated (");
    expect(settings).toContain("showDeactivated");
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
    expect(review).toContain("venueRequirements");
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
    const fields = readFileSync(resolve(root, "src/components/event-form/RequirementsFields.tsx"), "utf8");
    const pocFields = readFileSync(resolve(root, "src/components/event-form/PocFields.tsx"), "utf8");

    expect(fields).toContain('Field fieldKey="stage_setup" label="Stage Setup"');
    expect(fields).toContain('setReq("stage_setup"');
    expect(fields).toContain('Field fieldKey="foyer_setup" label="Foyer Setup"');
    expect(fields).toContain('setReq("foyer_setup"');
    expect(fields).toContain('Field fieldKey="licenses_status" label="Licences — Required"');
    expect(fields).toContain('setReq("licenses_status"');
    expect(fields).toContain('value="Awaiting"');
    expect(fields).toContain(">Awaiting</option>");
    expect(eventForm).toContain("programmeOfficers");
    expect(eventForm).toContain("lookups?.lookups.program_officer");
    expect(eventForm).toContain('Field label="Program Officer Contact"');
    expect(eventForm).toContain('setReq("program_officer_phone"');
    expect(fields).toContain('Field fieldKey="interval" label="Interval"');
    expect(fields).toContain('setReq("interval"');
    expect(fields).toContain('Field fieldKey="digital_standee_note" label="Digital Standee — notes"');
    expect(fields).toContain('Field fieldKey="car_display_note" label="Car Display — notes"');
    expect(eventForm).toContain("RequirementsFields");
    expect(eventForm).toContain("PocFields");
    expect(pocFields).toContain("vendor_registration_form");
    expect(pocFields).toContain("event_company_contact_name");
    expect(pocFields).toContain("event_company_contact_number");
    expect(pocFields).toContain("event_company_email");
    expect(pocFields).toContain("Event Company");
    expect(pocFields).toContain("VENDOR_REGISTRATION_OPTIONS");
    expect(pocFields).toContain("Point of Contact incomplete");
    expect(eventForm).toContain("hydrateVenueRequirements");
    expect(eventForm).toContain("updateVenueRequirements");
    expect(eventForm).toContain('searchParams.get("field")');
    expect(eventForm).toContain("requirement-field-${field}");
    expect(eventForm).toContain("focusedFieldKey={focusedRequirementField}");
  });

  it("exposes a New Event shortcut from the dashboard", () => {
    const dashboard = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

    expect(dashboard).toContain('to="/events/new"');
    expect(dashboard).toContain("+ New Event");
  });

  it("exposes Generate MoM on the event lifecycle panel", () => {
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    const mom = readFileSync(resolve(root, "src/lib/mom.ts"), "utf8");

    expect(detail).toContain("Generate MoM");
    expect(detail).toContain("onGenerateMom");
    expect(detail).toContain("buildMomDocument");
    expect(detail).toContain("buildMomDocumentHtml");
    expect(detail).toContain("Customised information");
    expect(detail).toContain("Copy Text");
    // MoM opens as a focused dialog so Continue / Generate is obvious.
    expect(detail).toContain('aria-labelledby="mom-panel-title"');
    expect(detail).toContain("fixed inset-0 z-50");
    expect(detail).toContain("Minutes of Meeting");
    // Rich preview + clipboard HTML for client email paste.
    expect(detail).toContain("dangerouslySetInnerHTML");
    expect(detail).toContain("text/html");
    expect(mom).toContain("text-decoration:underline");
    expect(mom).toContain("font-weight:700");
  });

  it("exposes a printable event form action on the lifecycle panel", () => {
    const detail = readFileSync(resolve(root, "src/pages/EventDetailPage.tsx"), "utf8");
    const helper = readFileSync(resolve(root, "src/lib/event-form-print.ts"), "utf8");
    const printable = readFileSync(resolve(root, "src/lib/open-printable.ts"), "utf8");

    expect(detail).toContain("onOpenEventFormPrintable");
    expect(detail).toContain("Print / PDF");
    expect(detail).toContain("openEventFormPrintable");
    expect(printable).toContain("openPrintableHtml");
    expect(helper).toContain("buildEventFormHtml");
    expect(helper).toContain("No documents uploaded.");
    expect(helper).toContain("Sign-off");
  });
});
