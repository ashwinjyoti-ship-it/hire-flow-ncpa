# Reports & Analytics — Audit and Redesign Plan

**Date:** 2026-07-10 · **Status:** Proposal (no code changes in this document)

---

## 0. Framing — the two jobs this section must do

The whole application exists so that the head of the venue-hire team has **control over the team's activity** while the team finds it **easier to action hire work**. Reports and Analytics are where that control becomes visible. They serve two different jobs:

| Section | Job | Audience | Cadence |
|---|---|---|---|
| **Reports** | The daily command loop: *"what must happen today"* (morning) and *"what actually happened"* (evening) | Head of team, then each team member | Twice daily, automatic |
| **Analytics** | The improvement loop: *present performance to management* and *find where the team loses time* | Head of team → NCPA management | Monthly / quarterly, on demand |

Everything below is judged against those two jobs.

---

## 1. Reports — audit of the current setup

### What exists

- A manual **"Generate snapshot"** button (Admin / Venue Manager) producing an immutable JSON snapshot per date (`daily_reports`), IST-correct.
- Five sections: **Scheduled** (schedule entries for the date), **System tasks** (auto tasks due), **Manual tasks** (manual tasks due), **Work achieved** (tasks completed + checklist items completed + status changes that day), **Outstanding** (open tasks due on or before the date, with days overdue).
- Exports: on-screen, print, Excel (per-section sheets), print-ready PDF HTML, Word.
- A cron Worker already runs every 30 minutes (task generation + email dispatch via Resend).

### What is good and must be kept

- **Immutable snapshots** — regenerating never rewrites history; past reports reopen exactly as saved. This is the right audit posture.
- **IST-correct date handling** throughout.
- The five sections are the **right raw ingredients** — the problem is presentation and delivery, not data.
- Multi-format export and RBAC gating.

### Gaps (why it does not yet do the job)

1. **Pull, not push.** The brief only exists if someone logs in and clicks *Generate*. The stated goal is a brief that *reaches her* at the start and end of the day. The scheduler and the Resend email pipeline already exist — reports simply never use them.
2. **One report for two different moments.** The same snapshot is generated morning or evening. A morning brief is forward-looking (plan, risks, decisions needed); an evening brief is retrospective (plan vs. done, slippage, tomorrow preview). Neither is currently expressed.
3. **No hierarchy of attention.** Everything is a flat table. The three things that genuinely need her decision are buried among forty routine rows. There is no "needs your decision" vs. "team is handling it" vs. "FYI".
4. **No accountability lens.** Due and outstanding work is not grouped by assignee. **Unassigned** tasks — the most dangerous category for a manager — are not surfaced as a category at all.
5. **Blind spots.** The snapshot ignores several things the data model already knows:
   - upcoming events (next 7–14 days) with **low checklist readiness** (`events.overall_completion`);
   - **blocked** checklist items;
   - **venue conflicts / potential conflicts** (overlapping confirmed/tentative bookings);
   - **VFH approvals pending**;
   - **stale enquiries** — enquiry/tentative events with no status movement or activity for N days;
   - **open instalment tasks overdue** (payment risk);
   - tentatives sitting on dates that another enquiry wants.
6. **The evening has no scoreboard.** "Work achieved" lists activity but never compares it against what was *due*. "17 of 21 tasks due today were completed; 4 slipped, here's who and why" is the single most valuable evening sentence and it cannot be produced today.
7. **Outstanding is unbounded.** Every open task due on or before the date accumulates forever. In three months this section will be 100+ rows and unreadable. There is no aging rollup ("12 tasks >14 days overdue — summary line") and no cap.
8. **Nothing for the team.** The report is a manager artifact only. Team members get generic notifications, not a personal "your day" list — so the report doesn't make it *easier for the team to action* anything.
9. **Read-only.** Nothing in the report can be acted on (reassign, nudge, bump priority, acknowledge). Every action requires navigating elsewhere and re-finding the item.

---

## 2. Reports — the redesign

### 2.1 Two first-class briefs

Replace the single "daily report" with two named, purpose-built briefs. Both remain immutable snapshots in `daily_reports` (add a `report_type` discriminator: `morning` | `evening`; the legacy type stays readable).

#### ☀️ Morning Brief — *"Here is your day"* (auto-generated 07:30 IST)

Ordered by attention, not by table:

1. **Headline strip** — five numbers, one line: events at the venues today · tasks due today · overdue · items needing her decision · new enquiries yesterday.
2. **Needs your decision** (the section that makes it "kick ass") — only items requiring *her*:
   - VFH approvals pending;
   - venue conflicts / potential conflicts on upcoming dates;
   - high-priority tasks overdue **and unassigned**;
   - cancellation/regret requests awaiting confirmation;
   - stale enquiries beyond the response threshold (default 3 days, configurable).
   Each with a one-line context and a deep link. Empty state: "Nothing needs your decision today." — that sentence alone is worth the feature.
3. **Today at the venues** — the current Scheduled section, grouped by venue with times, organisation and event status. Include a "first activity starts at…" callout.
4. **Team plan** — all tasks due today **grouped by assignee** (system + manual merged; type shown as a chip), with an explicit **Unassigned** group at the top if non-empty. Per person: count + list.
5. **Risk radar** — forward-looking exceptions:
   - events starting within 7 days with overall completion below threshold (default 70%);
   - blocked checklist items with the blocking reason;
   - open instalment tasks past due (payment risk);
   - documents/confirmations missing on confirmed events inside the window.
6. **Overdue** — aged buckets (1–3d, 4–7d, 8–14d, >14d) with the oldest 10 listed and the rest summarised by assignee. Never more than one screen.
7. **Yesterday in one line** — "Yesterday: 14 done, 3 slipped, 2 new enquiries, 1 confirmation won." (links to the evening debrief).

#### 🌙 Evening Debrief — *"Here is what happened"* (auto-generated 18:30 IST)

1. **Plan vs. done scoreboard** — tasks due today: done / rescheduled / missed, as a percentage and a one-line verdict. Same for checklist items with due dates. This is the section the whole feature is for.
2. **What got done** — completed tasks and checklist items **grouped by person** (celebrates throughput, exposes imbalance), plus event status changes (confirmations won get top billing).
3. **Slipped and why** — tasks due today still open, per assignee. When a due date is moved, capture a short **reschedule reason** (small product change on the task edit flow) so this section can show "moved to Fri — client hasn't sent layout".
4. **New today** — enquiries received, status transitions, documents uploaded, notable notes.
5. **Tomorrow preview** — tomorrow's venue schedule + tasks due count, so the morning holds no surprises.
6. **Trend chip** — 7-day sparkline of daily completion rate (plan-vs-done %), so a bad day is visible in context.

### 2.2 Delivery — push, not pull

- **Scheduler jobs** at 07:30 and 18:30 IST (the cron Worker already fires every 30 min; the job checks IST time and is idempotent per date + type — regeneration on demand still allowed and simply saves a newer snapshot).
- **Email the brief** through the existing Resend pipeline as a clean HTML digest (the sections above, in order) with deep links into the app. Recipients configurable in `app_settings`.
- The in-app Reports page remains the archive: list gets ☀️/🌙 icons, and the viewer renders the new attention-ordered layout. Print/Excel/Word exports carry over.
- Later (optional): a plain-text variant suitable for forwarding to WhatsApp.

### 2.3 Personal digests — the team's half of the bargain

Each active team member with tasks receives (or sees on their dashboard) a **"Your day"** mini-brief at 07:30: their tasks due today, their overdue items, and the venue schedule for events they're assigned to. Evening: their personal done/slipped line. This is what makes the team *want* the system — the boss's control becomes a by-product of something useful to them.

### 2.4 Make the brief actionable

On the in-app brief view (not the email): inline **reassign**, **bump priority**, **nudge** (sends the assignee a notification), and **acknowledge** on decision items. Every action goes through existing endpoints and lands in the audit log. The snapshot itself never mutates — actions affect live data only.

### 2.5 Configuration (all in `app_settings`, admin-editable)

| Setting | Default |
|---|---|
| Morning / evening send times | 07:30 / 18:30 IST |
| Email recipients (head + optional cc) | Admin + Venue Managers |
| Stale-enquiry threshold | 3 days |
| Readiness window / completion threshold | 7 days / 70% |
| Overdue list cap before aging rollup | 10 rows |
| Per-member personal digests on/off | on |

---

## 3. Analytics — audit of the current setup

### What exists

Five endpoints over a date range (default last 90 days), all counts and rates, deliberately **no revenue** (amount fields were removed in migration 0011): venue utilisation (booked days / calendar days per venue), inquiry conversion (status funnel + sources), payment tracking (checklist payment-status counts), operational performance (task throughput + average checklist completion), client & event profile (event/org types, top organisations, repeat-client flag). Rendered with restrained CSS bars; Word/print export.

### What is good

- The five areas are the right pillars; queries are honest (no invented numbers) and window logic is consistent.
- Zero-dependency rendering keeps the app light.

### Gaps (why it can't be presented to management yet, and can't drive efficiency)

1. **Snapshots, not trends.** Every number is a single aggregate over the range. Management's first question — *"is this improving?"* — cannot be answered. No month-by-month series exists.
2. **No comparison period.** No "vs. previous quarter" or "vs. same period last year". A deck number without a delta is noise.
3. **No velocity, despite the data existing.** `event_status_history` records every transition with timestamps, yet nothing computes: time-to-first-response on enquiries, enquiry→confirmed lead time, or time-in-stage. These are the funnel's most persuasive and most actionable numbers.
4. **Utilisation is naive.** Booked-days ÷ calendar-days treats a Tuesday like a Saturday and a setup day like a show day. No weekday profile, no venue × month seasonality, no show-vs-setup mix, no "days lost to cancellations".
5. **Losses are unexplained.** Regret/cancellation *reasons* are captured in status history and never aggregated. "Why we lose business" is a slide management will always ask for.
6. **Efficiency metrics are shallow.** One completion rate and an overdue count. No per-person on-time %, no task cycle times, no identification of *which checklist items* or *which lifecycle stages* consistently stall — i.e., nothing that tells the boss where to intervene.
7. **No value dimension at all.** Counts-only was a deliberate choice, but a management presentation with no financial or value proxy is structurally weak (see §4.4 — this is a decision, not a default).
8. **Presentation-hostile output.** CSS bars and Word tables; nothing drops into a deck or prints as an executive page.
9. **Repeat-client is a manual flag** on the event, when it is derivable from organisation booking history (and therefore currently under-counted).

---

## 4. Analytics — the redesign

Split the tab into two views for the two audiences:

### 4.1 📊 Boardroom view — *present to management*

A curated, print-perfect **Executive Pack** for a selected period (month / quarter / FY) with automatic comparison to the prior period and the same period last year:

1. **KPI headline band** — six tiles, each with value + delta arrow: enquiries received · conversion rate · events confirmed · venue utilisation % · cancellation rate · repeat-client rate.
2. **Demand & conversion trend** — 12-month lines: enquiries, confirmations, conversion %.
3. **Funnel with velocity** — stage-by-stage counts *and median days per stage* (from `event_status_history`): enquiry → tentative/approved → confirmed. Where the funnel leaks and how long it takes.
4. **Utilisation heatmap** — venue × month grid, plus a weekday profile per venue; show-days vs. setup/rehearsal-days split; days lost to cancellations.
5. **Source effectiveness** — enquiries and conversion rate per source; which channels bring business that closes.
6. **Client mix & retention** — event types, org types, top 10 organisations, *derived* repeat rate (orgs with 2+ events), new vs. returning.
7. **Lost business** — regrets/cancellations by aggregated reason and by stage at which they were lost.

**Exports:** A4-landscape print stylesheet producing a deck-quality PDF page per section; Excel appendix of every underlying table; copy-as-image on each chart for pasting into PowerPoint.

### 4.2 🔧 Engine-room view — *improve efficiency*

1. **Response SLA** — median and 90th-percentile time from enquiry creation to first status movement / first activity; count breaching the threshold.
2. **Team throughput** — per person: tasks completed, on-time %, median cycle time (created→completed), current open + overdue load. Framed as workload balance, not a leaderboard.
3. **Bottleneck finder** — checklist items ranked by median days from event confirmation (or item creation) to completion, and by how often they're blocked; lifecycle stages where events stall longest. This directly answers "what should we fix first?".
4. **Task hygiene** — % auto-tasks completed vs. cancelled, unassigned-task counts over time, overdue aging distribution.
5. **Automation health** — scheduler run status, notification delivery failures (from `scheduler_runs` / `notifications`).

### 4.3 KPI dictionary (definitions locked before any implementation)

| KPI | Definition | Source |
|---|---|---|
| Conversion rate | confirmed ÷ enquiries received in period (by enquiry date) | `events` |
| Time to first response | enquiry created → first status change or activity entry | `event_status_history`, `event_activity` |
| Enquiry→confirm lead time | median days, enquiry date → confirmed transition | `event_status_history` |
| Venue utilisation | distinct booked days ÷ available days, per venue; weekday-weighted variant | `schedule_entries` |
| Cancellation rate | cancelled ÷ (confirmed + cancelled) in period | `events`, status history |
| Repeat-client rate | orgs with ≥2 non-cancelled events (derived, not the manual flag) | `events`, `organisations` |
| Task on-time % | completed with `completed_at` ≤ due date ÷ tasks due in period | `tasks` |
| Task cycle time | median created→completed, by rule and by assignee | `tasks` |
| Checklist readiness | avg `overall_completion` for events starting in period, at N days out | `events` |
| Plan-vs-done % | tasks due on a day completed that day (feeds evening brief trend) | `tasks` |

Every number in the UI links to this dictionary (tooltip), so the boss can defend any figure in front of management.

### 4.4 The revenue decision (explicit, for the owner to make)

Amounts were deliberately removed from the checklist (migration 0011). Options, in increasing order of effort:

- **A. Stay counts-only** — cleanest, but the exec pack has no value axis.
- **B. Single "estimated value" field per event** (optional, editable by Venue Manager) — enables pipeline value, confirmed value trend, value by source/venue, with near-zero workflow burden. **Recommended.**
- **C. Full instalment amounts + received tracking** — real receivables analytics, but re-introduces the data-entry burden that was removed. Not recommended now.

### 4.5 Data foundations (kept deliberately small)

- Extend the five endpoints (or add `/analytics/timeseries`) with `group_by=week|month` and `compare=previous_period|previous_year` parameters — D1 handles this scale without materialisation.
- New derived queries over `event_status_history` for stage durations and loss reasons; over `tasks` for cycle times.
- Optional later: a monthly rollup table written by the scheduler if query latency ever warrants it (it won't at current volume).
- Charts: keep the no-dependency philosophy — CSS bars stay; add small inline SVG line/sparkline and heatmap components (a chart library is justified only if the exec pack needs more than lines, bars, heatmaps and a funnel — it doesn't).

---

## 5. Roadmap

| Phase | Scope | Why this order |
|---|---|---|
| **1. The brief that arrives** | Morning/Evening brief content (attention-ordered sections incl. *Needs your decision*, team plan by assignee, plan-vs-done scoreboard, overdue aging), scheduler auto-generation, email delivery via Resend | Delivers the core stated goal in one step; pure recomposition of data the app already has |
| **2. The team's half** | Personal "Your day" digests, actionable brief (reassign/nudge/acknowledge), reschedule-reason capture, settings panel | Makes the system pull the team in; enriches the evening "slipped and why" |
| **3. Analytics foundations** | Time-series + comparison params, velocity metrics from status history, derived repeat rate, loss-reason aggregation | Turns analytics from snapshot to trajectory; prerequisite for the pack |
| **4. Boardroom pack** | Exec Pack layout, heatmaps/sparklines, A4 print/PDF export, Excel appendix, KPI dictionary tooltips | The management-presentation deliverable |
| **5. Engine room** | SLA panel, throughput/cycle times, bottleneck finder, task hygiene, automation health; revenue option B if approved | The continuous-improvement deliverable |

**Success measures:** the head opens the app *zero* times before the morning brief arrives (it comes to her); "Needs your decision" is empty most days; evening plan-vs-done % is visible and trending up; the quarterly management deck is produced from the Exec Pack in under ten minutes; bottleneck finder drives at least one process change per quarter.
