# Show Calendar Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Show Calendar event-card details a show/venue operations view, distinct from the lifecycle/admin record view.

**Architecture:** Keep Lifecycle Calendar cards linked to the full event lifecycle page. Keep Show Calendar cards opening an in-calendar detail drawer, but enrich that drawer with show-specific fields from the schedule entry, venue booking, and parent event. Add a small API payload expansion rather than introducing a second event-detail route.

**Tech Stack:** React, TypeScript, Vite, Hono Worker API, D1 SQL, Vitest regression tests.

---

### Task 1: Protect The Intended Calendar Split

**Files:**
- Modify: `worker/__tests__/frontend-regressions.test.ts`

- [ ] **Step 1: Write the failing frontend guard**

Add this test inside `describe("frontend regression guards", ...)`:

```ts
it("keeps show calendar details separate from lifecycle record navigation", () => {
  const calendar = readFileSync(resolve(root, "src/pages/CalendarPage.tsx"), "utf8");

  expect(calendar).toContain("ShowCalendarDetailPanel");
  expect(calendar).toContain("Open full record");
  expect(calendar).toContain("View show details");
  expect(calendar).toContain("with_ac_start");
  expect(calendar).not.toContain("Open full record →");
});
```

- [ ] **Step 2: Run the guard and verify it fails**

Run:

```bash
npm test -- worker/__tests__/frontend-regressions.test.ts
```

Expected: the new test fails because the current show drawer only has a small side panel and still presents “Open full record →” as the main destination.

- [ ] **Step 3: Commit the failing test only if using strict multi-commit TDD**

Run:

```bash
git add worker/__tests__/frontend-regressions.test.ts
git commit -m "Add show calendar detail regression guard"
```

### Task 2: Expand The Show Calendar API Payload

**Files:**
- Modify: `worker/routes/calendar.ts`
- Modify: `worker/__tests__/api-regressions.test.ts`

- [ ] **Step 1: Write the failing API regression**

Extend the existing show-calendar API tests with:

```ts
it("serves show-specific details for the show calendar drawer", async () => {
  const db = makeDbMock((sql) => {
    if (sql.includes("FROM schedule_entries se")) {
      expect(sql).toContain("se.with_ac_start");
      expect(sql).toContain("se.with_ac_end");
      expect(sql).toContain("se.without_ac_start");
      expect(sql).toContain("se.without_ac_end");
      expect(sql).toContain("se.notes AS schedule_notes");
      expect(sql).toContain("vb.number_of_shows");
      expect(sql).toContain("vb.requirements");
      expect(sql).toContain("vb.notes AS venue_notes");
      expect(sql).toContain("e.event_code");
      expect(sql).toContain("e.event_owner");
    }
    return {
      all: () => ({
        results: [{
          id: "se_1",
          activity_type: "show",
          activity_date: "2026-09-10",
          start_time: "19:00",
          end_time: "21:00",
          with_ac_start: "18:00",
          with_ac_end: "21:30",
          without_ac_start: "14:00",
          without_ac_end: "17:00",
          schedule_notes: "Main performance",
          event_id: "ev_1",
          event_code: "NCPA-001",
          title: "Classical Recital",
          status: "confirmed",
          event_type: "VFH",
          organisation_name: "ACE Production",
          event_owner: "Aditi Rao",
          venue: "JBT",
          booking_status: "confirmed",
          number_of_shows: 2,
          requirements: "Green room",
          venue_notes: "Piano tuned",
        }],
      }),
    };
  });
  const app = makeTestApp(db);

  const res = await app.request("/calendar?from=2026-09-01&to=2026-09-30", {}, envWithUser());
  const body = await res.json() as { entries: Array<Record<string, unknown>> };

  expect(body.entries[0]).toMatchObject({
    event_code: "NCPA-001",
    event_owner: "Aditi Rao",
    with_ac_start: "18:00",
    without_ac_start: "14:00",
    number_of_shows: 2,
    requirements: "Green room",
    venue_notes: "Piano tuned",
  });
});
```

- [ ] **Step 2: Run the API regression and verify it fails**

Run:

```bash
npm test -- worker/__tests__/api-regressions.test.ts
```

Expected: FAIL because `/calendar` does not yet select these show-specific fields.

- [ ] **Step 3: Expand the SQL selection**

In `worker/routes/calendar.ts`, update the show-calendar `SELECT` to include:

```sql
se.with_ac_start,
se.with_ac_end,
se.with_ac_minutes,
se.without_ac_start,
se.without_ac_end,
se.without_ac_minutes,
se.notes AS schedule_notes,
e.event_code,
e.event_owner,
e.description,
e.notes AS event_notes,
vb.booking_status,
vb.number_of_shows,
vb.requirements,
vb.notes AS venue_notes
```

- [ ] **Step 4: Run the API regression and verify it passes**

Run:

```bash
npm test -- worker/__tests__/api-regressions.test.ts
```

Expected: PASS.

### Task 3: Build The Show-Specific Detail Drawer

**Files:**
- Modify: `src/pages/CalendarPage.tsx`
- Test: `worker/__tests__/frontend-regressions.test.ts`

- [ ] **Step 1: Extend `CalEntry`**

Add these fields to `type CalEntry`:

```ts
event_code: string | null;
event_owner: string | null;
description: string | null;
event_notes: string | null;
booking_status: string | null;
number_of_shows: number | null;
requirements: string | null;
venue_notes: string | null;
with_ac_start: string | null;
with_ac_end: string | null;
with_ac_minutes: number | null;
without_ac_start: string | null;
without_ac_end: string | null;
without_ac_minutes: number | null;
schedule_notes: string | null;
```

- [ ] **Step 2: Replace the inline side panel with a named component**

In `CalendarPage`, replace the current `{sideEvent && (...)}` block with:

```tsx
{sideEvent && <ShowCalendarDetailPanel entry={sideEvent} onClose={() => setSideEvent(null)} />}
```

- [ ] **Step 3: Add `ShowCalendarDetailPanel`**

Add this component near the calendar helper components:

```tsx
function ShowCalendarDetailPanel({ entry, onClose }: { entry: CalEntry; onClose: () => void }) {
  const surface = getEventStatusSurface(entry.status);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-primary/20 backdrop-blur-sm" onClick={onClose}>
      <aside className={"carved-card h-full w-full max-w-xl overflow-y-auto scroll-slim rounded-l-2xl border-l-4 bg-marble-highlight p-6 " + surface.card + " " + surface.border} onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-sage etched">View show details</div>
            <h3 className="text-xl font-semibold text-ink-primary etched-deep">{entry.title}</h3>
            <p className="mt-1 text-xs text-ink-muted etched">{entry.organisation_name ?? "No organisation"}{entry.event_code ? ` · ${entry.event_code}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} className="text-ink-muted hover:text-ink-secondary" aria-label="Close">x</button>
        </div>

        <section className="mb-4 grid grid-cols-2 gap-3 text-xs">
          <SummaryPill label="Venue" value={entry.venue} />
          <SummaryPill label="Activity" value={entry.activity_type.replace(/_/g, " ")} />
          <SummaryPill label="Date" value={formatDate(entry.activity_date)} />
          <SummaryPill label="Time" value={formatRange(entry.start_time, entry.end_time)} />
          <SummaryPill label="Shows" value={String(entry.number_of_shows ?? 1)} />
          <SummaryPill label="Booking" value={entry.booking_status ?? "-"} />
          <SummaryPill label="Owner" value={entry.event_owner ?? "-"} />
          <SummaryPill label="Type" value={entry.event_type ?? "-"} />
        </section>

        <section className="mb-4 rounded-xl bg-marble-shadow/30 p-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">AC timings</h4>
          <div className="space-y-2 text-sm">
            <DetailLine label="With AC" value={formatTimedDuration(entry.with_ac_start, entry.with_ac_end, entry.with_ac_minutes)} />
            <DetailLine label="Without AC" value={formatTimedDuration(entry.without_ac_start, entry.without_ac_end, entry.without_ac_minutes)} />
          </div>
        </section>

        <section className="space-y-3 rounded-xl bg-marble-shadow/30 p-4 text-sm">
          <DetailLine label="Requirements" value={entry.requirements ?? "-"} />
          <DetailLine label="Venue notes" value={entry.venue_notes ?? "-"} />
          <DetailLine label="Schedule notes" value={entry.schedule_notes ?? "-"} />
          <DetailLine label="Event notes" value={entry.event_notes ?? entry.description ?? "-"} />
        </section>

        <Link to={`/events/${entry.event_id}?tab=venues`} className="carved-btn mt-6 inline-block rounded-full bg-neutral-btn px-5 py-2 text-sm font-semibold text-ink-secondary etched">
          Open full record
        </Link>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Add small formatting helpers**

Add:

```ts
function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return "-";
  if (!end) return start ?? "-";
  return `${start ?? "-"} - ${end}`;
}

function formatTimedDuration(start: string | null, end: string | null, minutes: number | null): string {
  const range = formatRange(start, end);
  if (range === "-" && minutes == null) return "-";
  return minutes == null ? range : `${range} (${formatDuration(minutes)})`;
}
```

- [ ] **Step 5: Reuse or add compact display helpers**

If `SummaryItem` is not available in `CalendarPage.tsx`, add local helpers:

```tsx
function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-marble-shadow/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted etched">{label}</div>
      <div className="mt-1 font-semibold capitalize text-ink-primary etched-deep">{value}</div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
      <dt className="text-ink-muted etched">{label}</dt>
      <dd className="font-medium text-ink-primary etched-deep">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 6: Run the frontend guard and verify it passes**

Run:

```bash
npm test -- worker/__tests__/frontend-regressions.test.ts
```

Expected: PASS.

### Task 4: Verify The End-To-End Experience

**Files:**
- No new files unless a targeted browser test already exists.

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Browser-check the deployed or local UI**

Open the app and verify:

```text
Calendar → Show Calendar → click an event chip
```

Expected:

```text
The drawer title reads "View show details".
The drawer shows venue, activity, show date, main timing, AC timings, number of shows, booking status, owner, type, requirements, venue notes, schedule notes, and event notes where data exists.
The primary content is not lifecycle status/action/blocker content.
The secondary "Open full record" action opens the event on the Venues tab.
Lifecycle Calendar cards still open the lifecycle/event record path.
```

- [ ] **Step 3: Commit**

Run:

```bash
git add worker/routes/calendar.ts worker/__tests__/api-regressions.test.ts src/pages/CalendarPage.tsx worker/__tests__/frontend-regressions.test.ts
git commit -m "Add show calendar detail view"
```

### Task 5: Publish

**Files:**
- No source files.

- [ ] **Step 1: Push and open PR**

Run:

```bash
git push -u origin agent/show-calendar-detail-view
gh pr create --base main --head agent/show-calendar-detail-view --title "Add show calendar detail view" --body-file /tmp/show-calendar-detail-view-pr.md
```

- [ ] **Step 2: Merge after CI passes**

Run:

```bash
gh pr merge --merge --delete-branch
git switch main
git pull --ff-only
```

Expected: main contains the new show-calendar detail drawer, and the public site updates after deployment.

---

## Self-Review

- Spec coverage: Show Calendar gets its own show-detail drawer; Lifecycle Calendar remains lifecycle/admin focused; show fields include schedule timing, AC timing, venue booking, organisation, owner, type, notes, and requirements.
- Placeholder scan: No TBD/TODO steps.
- Type consistency: `CalEntry` fields match the SQL aliases and the React component props.
