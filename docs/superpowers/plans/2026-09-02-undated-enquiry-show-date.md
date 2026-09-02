# Plan: Enquiries with no date of show

Staff can file a Venue for Hire enquiry when the client has no show date yet. The record appears on the Lifecycle calendar on the day it is registered, marked **No date of show**. A real show date is still required before the event can be confirmed.

## Problem

Create enquiry requires Operating Window — Start Date. Many first contacts are “we are interested” with no date. Staff either invent a date or cannot save the enquiry.

Lifecycle already places an enquiry chip on `enquiry_date`, or on `date(created_at)` if that is empty. That created-day placement is correct for an undated enquiry. What is missing is the ability to save without a show date, and a visible mark that the date is unknown.

## Desired behaviour

1. New enquiry can be saved with organisation + event name only.
2. Operator can explicitly say the date of show is not known (checkbox). Date inputs then clear and disable.
3. The enquiry lands on Lifecycle for **today** (registration day), with a **No date of show** badge.
4. Event detail and dashboard say the same thing. They must not look like a show on today.
5. Later, staff add a show date. The Lifecycle chip stays on the original enquiry day. The badge goes away.
6. Tentative, regret, and cancel stay allowed without a date. Confirm and Approve require a date.
7. Dated enquiries keep working as they do now, including the same-org-same-date duplicate block.

## Approach

No schema change. `events.event_start_date` is already nullable. Several read paths already treat NULL as undated (dashboard “undated enquiries received in the last 30 days”, event list sort, Excel import). Create and update are what forbid that state.

`event_start_date IS NULL` is the signal. No new column, no new status.

On create, also write `enquiry_date` as today’s Asia/Kolkata date so Lifecycle has an explicit enquiry day. Keep the existing fallback to `created_at` for older rows.

## What is blocking it today

| Place | Block |
|---|---|
| `canCreateEvent()` | Requires a non-empty start date, so Save stays disabled |
| `POST /events` | Extra 422: “Event start date is required” |
| `PUT /events/:id` | Extra 422: “Event start date cannot be cleared” |
| `POST /events` insert | Does not write `enquiry_date` |
| Lifecycle chips | No badge; only the overflow panel says “Show date not set” |
| Event detail Dates | Shows `-` |
| Show Calendar SQL | `COALESCE(event_start_date, status-changed-at, created_at)` — if an undated record were ever confirmed, it would appear as a show on the created day |
| `nextAvailableScheduleDate()` | If start date is missing, new schedule days default to **today** |

Zod already allows a null start date. Date-range checks only run when dates are present.

## Work

### 1. Event form

Files: `src/lib/event-edit-form.ts`, `src/pages/EventEditPage.tsx`, `src/components/event-form/VenueScheduleFields.tsx`, matching tests.

- Title + organisation is enough to save.
- Add **Date of show not known** next to the single-day checkbox.
  - Checked: clear start and end, disable the date inputs, drop the `*` from the start-date label.
  - Helper: this enquiry appears on Lifecycle on the day it is registered; add a show date later before confirming.
  - Unchecking does not invent today’s date.
- Skip the date-keyed duplicate query when there is no start date (that check is same-org-same-date).
- Adding a schedule day with no operating window must leave the day undated. Do not substitute today. Existing save logic already drops undated schedule stubs.

### 2. API

File: `worker/routes/events.ts`, plus API tests.

- Remove the create “date required” and update “cannot be cleared” guards.
- If start is null, force end null.
- On create, set `enquiry_date` to today (IST).
- Skip `findLikelyDuplicateEvents` when there is no start date.
- Status change: Confirm and Approve require a usable `event_start_date`. The current status SELECT does not load that column — add it. Tentative / regret / cancel stay allowed.
- Same message on the event-detail status actions.

### 3. Indicator

Files: `src/pages/CalendarPage.tsx`, `src/lib/lifecycle-calendar-display.ts`, `src/pages/EventDetailPage.tsx`, `src/pages/DashboardPage.tsx`.

One label everywhere: **No date of show** (chip can shorten to **No date**, full phrase on hover).

- Lifecycle month chip and mobile agenda.
- Overflow cards (replace “Show date not set”).
- Event detail Dates row.
- Dashboard pipeline: keep `Entered {registration date}` and add the badge so it is not read as a show date.

Do not move the chip off the enquiry/created day when a show date is added later.

### 4. Do not invent a show day

Files: `worker/routes/calendar.ts`, `worker/routes/analytics.ts`, `worker/__tests__/api-regressions.test.ts`.

Show Calendar date-anchored rows must require a real show date or a real schedule date. NULL start must not fall back to created/status-changed.

Occupancy / utilization queries that treat `COALESCE(event_start_date, created_at)` as a show day must exclude NULL start dates. Enquiry-conversion that windows on enquiry/created date stays as it is.

### 5. Checks

Automated: `event-edit-form` tests, event create/update/status tests, calendar and frontend regression guards, `dashboard-operational-counts`.

Browser:

1. New enquiry, box checked, no date → saves.
2. Lifecycle today shows the chip with **No date**.
3. Detail and dashboard show **No date of show** / Entered today.
4. Tentative works. Confirm and Approve are blocked.
5. Edit, uncheck, set a date → badge gone; Lifecycle chip still on the original enquiry day; Show Calendar empty until Confirmed.
6. Dated enquiry unchanged, including duplicate warning.

## Risks

- Confirm without a date would put a fake show on the created day. Block Confirm/Approve, and stop the Show Calendar COALESCE.
- Occupancy charts would count undated enquiries as happening today unless those queries ignore NULL start dates.
- Schedule step currently defaults missing dates to today — that must change or an undated enquiry quietly grows a “show today” row.
- Date-keyed duplicates do not apply; do not hard-block save on title+org alone.

## Out of scope

- Public client enquiry form
- A separate “undated” list or status
- A new database column
- Inventing a placeholder show date
- Changing the existing Confirm financial/approval gates beyond the extra date requirement

## Order

Form and API together so an undated enquiry can actually save. Indicator next so the first saved record is not silent. Show Calendar / analytics safety before any confirm-path testing.
