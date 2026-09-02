# Implementation Plan: Undated Enquiries (No Date of Show)

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can register a lifecycle enquiry when the client has no show date yet. The record stays on the Lifecycle calendar on the date it was created, with a clear “no date of show” indicator. A show date remains required before the event can be confirmed (and therefore appear on the Show Calendar as a real show).

**Architecture:** Reuse the existing nullable `events.event_start_date` column as the source of truth. Do **not** add a new flag column. NULL already means “undated” in the dashboard, import path, and several calendar/list queries — only create/update currently forbid that state.

**Tech Stack:** React 18 + Vite, Hono Pages Functions, D1 SQLite, Vitest.

---

## Overview

Venue-hire enquiries often arrive as “we are interested” with no particular date. Today the new-event form and API treat Operating Window — Start Date as compulsory, so staff cannot file the enquiry without inventing a date.

Lifecycle already places enquiry chips on `enquiry_date`, falling back to `date(created_at)`. That fallback is the correct home for an undated enquiry. The missing piece is: allow `event_start_date` to stay NULL, mark the record as having no date of show, and keep later stages (especially Confirm) honest about needing a real date.

## Specification Link

Operator request (Cloud Agent, 2026-09-02): *“To submit an enquiry to the lifecycle calendar the date of show is compulsory. Often the enquiry comes with no particular date in mind. We still need to register such enquiries with an indicator that this one does not have a date of show. As it is, the event in lifecycle is stored on the date the record is created.”*

Notion MCP was not available in this environment (desktop auth required). This file is the working specification until a Notion page can be created from it.

## Current behaviour (what already exists)

| Layer | Today |
|---|---|
| Schema | `events.event_start_date` and `event_end_date` are nullable TEXT. `enquiry_date` is also nullable. |
| Zod | `EventInput.event_start_date` is already `IsoDate.nullish()`. |
| Create API | Extra guard: `if (!d.event_start_date) return 422 "Event start date is required"`. `enquiry_date` is **not** written on create. |
| Update API | Extra guard: `if (d.event_start_date === null) return 422 "Event start date cannot be cleared"`. |
| New-event form | `canCreateEvent()` requires a non-empty start date. Label is `Operating Window — Start Date *`. Save is disabled without it. |
| Date policy | `getEventDateIssues()` only compares dates when they are present. Empty start is already valid there. |
| Lifecycle SQL | Enquiry milestone = `enquiry_date`, else `date(created_at)`. Status is **not** placed on `event_start_date`. |
| Dashboard | Active enquiries card already counts “undated enquiries received in the last 30 days”. Pipeline rows already say `Entered {milestone_date}` when there is no usable show date. |
| Lifecycle overflow | Already falls back to `"Show date not set"`. Month chips do **not** show that. |
| Show Calendar | Date-anchored confirmed rows `COALESCE(event_start_date, status-changed-at, created_at)` — an undated **confirmed** event would appear on the wrong day. |
| Import / seed | Excel import already stores null show dates. |

**Implication:** most of the read path is ready. The work is unlocking write, making the indicator obvious, and stopping undated records from leaking onto the Show Calendar as if they had a show date.

## Technical Approach

1. **Canonical signal:** `event_start_date IS NULL` means “no date of show”. No migration. When the start date is cleared, also clear `event_end_date`.
2. **Enquiry date on create:** write `enquiry_date` as today’s Asia/Kolkata calendar date so Lifecycle has an explicit enquiry day instead of relying only on `created_at`. Keep the existing `COALESCE(enquiry_date, date(created_at))` fallback.
3. **Form control:** a “Date of show not known” checkbox next to the operating-window fields. Checked → dates cleared and date inputs disabled. Unchecked on edit when a start date is present.
4. **Lifecycle indicator:** same wording everywhere — **No date of show**. Show it on Lifecycle chips (compact), overflow cards, event detail summary, event edit, and dashboard pipeline rows that currently say only “Entered …”.
5. **Hard gate on Confirm:** `POST /events/:id/status` to `confirmed` requires a usable `event_start_date`. Optional but recommended: also require a date for `approved`. Tentative (client still unsure) may stay undated.
6. **Show Calendar safety:** date-anchored confirmed SQL must not `COALESCE` a missing show date to created/status-changed. Undated confirmed events must not invent a show day.
7. **Duplicates:** skip the same-org-same-date duplicate block when the enquiry is undated. Optionally warn on same-org + same title only (warning, not a hard 409).
8. **Analytics:** occupancy / utilization queries that `COALESCE(event_start_date, date(created_at))` must exclude NULL show dates so undated enquiries do not inflate “shows this month”.

---

## Phases

### Phase 1 — Event form: optional show date + indicator

**Files:**
- `src/lib/event-edit-form.ts`
- `src/lib/event-edit-form.test.ts`
- `src/pages/EventEditPage.tsx`
- `src/components/event-form/VenueScheduleFields.tsx` (schedule-day default already uses `eventStartDate`; empty start must still add a day without inventing a date)
- `worker/__tests__/frontend-regressions.test.ts`

- [ ] **1.1 Relax create validation**

Change `canCreateEvent` so title + organisation are enough. Keep date-range errors via `getEventFormDateError` when a date *is* present.

```ts
export function canCreateEvent(form: Pick<EventInputT, "title" | "organisation_id">): boolean {
  return form.title.trim().length > 0 && form.organisation_id.trim().length > 0;
}

export function hasShowDate(form: Pick<EventInputT, "event_start_date">): boolean {
  return Boolean(form.event_start_date?.trim());
}
```

Update the existing test that currently expects a missing date to block submit. Add a test that an undated enquiry with title + org **can** save.

- [ ] **1.2 Add the “Date of show not known” control**

On Step 1 of `EventEditPage`, next to the single-day checkbox:

- Checkbox label: `Date of show not known`
- When checked: set `event_start_date` and `event_end_date` to `null`, disable both date inputs, drop the `*` from the start-date label
- Helper text: `This enquiry will appear on the Lifecycle calendar on the date it is registered. Add a show date later before confirming.`
- When unchecked after being checked: leave dates empty so the operator picks them; do not invent today as the show date

- [ ] **1.3 Duplicate check**

`duplicateCheckReady` currently requires `form.event_start_date`. For undated enquiries, either skip the query or run a title+org-only check that does not hard-disable Save.

- [ ] **1.4 Schedule step**

`nextAvailableScheduleDate(eventStartDate, …)` must tolerate a null start (leave new schedule days undated, matching the existing “drop undated stubs on save” behaviour). Do not default schedule days to today.

- [ ] **1.5 Frontend regression guard**

Update `frontend-regressions.test.ts` so it still pins `canCreateEvent(form) && !hasDuplicateWarning`, and add a string guard for `Date of show not known` / `No date of show`.

### Phase 2 — API: allow create and clear

**Files:**
- `worker/routes/events.ts`
- `worker/lib/event-date-policy.ts` (only if a new “end date without start” rule is needed)
- New or existing API tests under `worker/__tests__/`

- [ ] **2.1 Create**

Remove:

```ts
if (!d.event_start_date) return c.json({ error: "Event start date is required", field: "event_start_date" }, 422);
```

Keep `getEventDateIssues` for inconsistent ranges / post-show schedule dates.

On insert, set `enquiry_date` to today’s IST date (`date(created_at)` equivalent already used in briefs). Include `enquiry_date` in the INSERT column list.

If `event_start_date` is null, force `event_end_date` null.

Skip `findLikelyDuplicateEvents` when `event_start_date` is empty (that helper is date-keyed).

- [ ] **2.2 Update**

Remove:

```ts
if (d.event_start_date === null) return c.json({ error: "Event start date cannot be cleared", field: "event_start_date" }, 422);
```

Allow clearing. If start is cleared, also clear end. Skip the post-show checklist date check when the final show date is null.

- [ ] **2.3 Confirm / approve gate**

In `POST /:id/status`, before `canConfirm`:

```ts
if ((to === "confirmed" || to === "approved") && !usableShowDate(event.event_start_date)) {
  return c.json({
    error: "Add a date of show before moving this enquiry on. Undated enquiries stay at Enquiry or Tentative.",
    field: "event_start_date",
  }, 422);
}
```

Select `event_start_date` on the event row (the current SELECT omits it). Surface the same message on the event-detail status actions.

Tentative and regret/cancel stay allowed without a date.

- [ ] **2.4 API tests**

- POST `/events` with title + org and `event_start_date: null` → 201, stored null, `enquiry_date` set
- PUT clearing `event_start_date` → 200
- PUT end date without start → 422
- POST status `confirmed` (and `approved`) while undated → 422
- POST status `tentative` while undated → 200
- Dated create still works; existing date-order errors still fire

### Phase 3 — Lifecycle and record surfaces: indicator

**Files:**
- `src/pages/CalendarPage.tsx` (`LifecycleChip`, `LifecycleOverflowPanel`, mobile lifecycle agenda)
- `src/lib/lifecycle-calendar-display.ts` (prefer a small helper, e.g. `showDateMissingLabel()`)
- `src/pages/EventDetailPage.tsx` (Dates summary currently shows `"-"`)
- `src/pages/DashboardPage.tsx` (pipeline “Entered …” line)
- `src/pages/EventEditPage.tsx` (edit mode banner when loaded record is undated)
- Tests: `src/lib/lifecycle-calendar-display` (new) and existing calendar/dashboard tests

- [ ] **3.1 Shared copy**

One label: **No date of show**. Overflow already says `"Show date not set"` — change it to the shared helper so search/tests have one string.

- [ ] **3.2 Lifecycle chip**

On `LifecycleChip`, when `!entry.event_start_date`, show a compact badge (same visual weight as the existing POC chip), e.g. `No date`. Include the phrase in `title` for hover.

Do **not** move the chip off `milestone_date`. Undated enquiries stay on the registration / enquiry day.

- [ ] **3.3 Event detail + dashboard**

Detail Dates row: `No date of show` instead of `-`. Dashboard pipeline: keep `Entered {date}` and add the same badge so it is not mistaken for a show date.

- [ ] **3.4 Month grid vs Show Calendar**

Lifecycle month view continues to list the enquiry on the created/enquiry day. Show Calendar stays confirmed-only and must not gain a fake operating-window card for a null show date (Phase 4).

### Phase 4 — Show Calendar and analytics safety

**Files:**
- `worker/routes/calendar.ts` (show-calendar `showDateExpr`)
- `worker/__tests__/api-regressions.test.ts`
- `worker/routes/analytics.ts` (queries that `COALESCE(e.event_start_date, date(e.created_at))`)

- [ ] **4.1 Stop inventing a show day**

The Show Calendar date-anchor is:

```sql
COALESCE(normalised(event_start_date), substr(status_history.changed_at, 1, 10), date(created_at))
```

That was for confirmed imports with unparseable dates. Once staff can legally save NULL, this COALESCE would park an undated confirmed event on created/status day — the exact confusion this feature is meant to avoid.

Change date-anchored show rows to require a normalised `event_start_date` (or a real schedule `activity_date`). Keep the import fallback only when the stored start date is non-empty but unparseable (existing `normalisedDateSql` behaviour), not when it is NULL.

Add/adjust the regression in `api-regressions.test.ts` that currently documents the COALESCE.

- [ ] **4.2 Analytics windows**

Enquiry-conversion already windows on `enquiry_date` / `created_at` — leave that. Occupancy / utilization / “events in period” queries that treat `COALESCE(event_start_date, created_at)` as a show day must use `event_start_date IS NOT NULL` (or skip the created_at fallback).

### Phase 5 — Verification

- [ ] **5.1 Automated**

`npm run test`, `npm run typecheck`, `npm run lint`. Targeted suites: `src/lib/event-edit-form.test.ts`, event API tests, `api-regressions.test.ts`, `frontend-regressions.test.ts`, `dashboard-operational-counts.test.ts`.

- [ ] **5.2 Manual (browser, `/events/new` → Lifecycle)**

1. Create an enquiry with org + name, **Date of show not known** checked, no start date → save succeeds.
2. Lifecycle calendar for **today** shows the enquiry chip with **No date**.
3. Event detail Dates = **No date of show**. Dashboard pipeline shows **Entered today** + badge.
4. Status → Tentative works; Confirm (and Approve) is blocked with the date message.
5. Edit the same record, uncheck the box, set a start date, save → badge disappears; Lifecycle chip stays on the original enquiry day (not the new show day); Show Calendar still empty until Confirmed.
6. Create a normal dated enquiry → unchanged; duplicate warning still fires for same org + date.
7. Mobile lifecycle agenda shows the same badge.

---

## Dependencies

- Local D1 already has the nullable columns — **no migration**.
- Admin login for browser checks: `admin@ncpa.test` / seeded password in `AGENTS.md`.
- Seeded dropdowns/checklists required for the event form to render (`npm run db:seed:local` if the VM DB is empty).
- Existing dashboard undated-enquiry counting (`src/lib/dashboard-operational-counts.ts`) should keep working once create can produce NULL start dates; add a case if coverage is only on imported fixtures.

## Risks

| Risk | Mitigation |
|---|---|
| Confirming an undated event parks it on created_at in Show Calendar | Phase 2 confirm gate + Phase 4 COALESCE change. Do both; the gate is product, the SQL change is a safety net. |
| Staff confuse Lifecycle day (registered) with show day | Persistent **No date of show** badge on chip, overflow, detail, dashboard. Helper text on the form. |
| Duplicate detection goes blind | Skip date-keyed 409 only when undated; optional soft warning on same org + title. |
| Occupancy charts count undated enquiries as “happening today” | Phase 4 analytics filter. |
| Schedule step invents today’s date | `nextAvailableScheduleDate` must not substitute today for a missing operating window. |
| Clearing a date after schedule/accounts work | Allowed at Enquiry/Tentative. Confirm/Approve blocked. Post-show checklist checks already no-op when `finalShowDate` is null. |
| `enquiry_date` still null on old rows | Keep `COALESCE(..., date(created_at))` in Lifecycle SQL. New creates write `enquiry_date`. |

## Out of scope

- Public / client-facing enquiry form
- Changing Lifecycle to a separate “undated” bucket or list page (calendar remains the hub)
- New D1 column or status value (`enquiry_undated`)
- Auto-assigning a placeholder show date
- Changing Confirm financial/approval gates beyond the extra show-date requirement

## Suggested implementation order

Phase 1 (form) and Phase 2 (API) together so create actually works. Phase 3 (indicator) next so the first saved undated enquiry is not silent. Phase 4 before any confirm-path testing. Phase 5 last.
