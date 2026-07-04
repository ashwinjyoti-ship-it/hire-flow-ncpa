# Data Model

The application uses Cloudflare D1 (SQLite-compatible). All timestamps are stored as ISO-8601 UTC strings; the application renders them in **Asia/Kolkata**. Currency is **INR**. IDs are application-generated text (compact ULID-like).

## Hierarchy

```
Organisation / Client
└── Event
    ├── Venue Bookings
    │   └── Schedule Entries
    ├── Checklist Items (Operations + Accounts)
    ├── Tasks (automatic + manual)
    ├── Notifications
    ├── Documents (metadata in D1, file in R2)
    └── Activity History
```

## Core tables

| Table | Purpose |
|---|---|
| `users` | Auth principals (email, scrypt hash, role, TOTP secret, recovery codes) |
| `sessions` | httpOnly secure server-side sessions |
| `audit_logs` | System-level audit (auth, role changes, overrides, date corrections) |
| `organisations` | Clients (name, GST/PAN/TAN, bank details, notes) |
| `contacts` | People at organisations (1 org → many contacts) |
| `events` | Master event record (status, type VFH/EE/FR/FE, dates, completion rollups) |
| `event_status_history` | Every status transition (from/to/who/when/reason) |
| `venue_bookings` | One event → many venue bookings (venue, shows, AC timings, requirements) |
| `schedule_entries` | One booking → many entries (Setup/Rehearsal/Show/Dismantling/Technical Meeting) |
| `checklist_definitions` | Template items seeded from workbooks (89 definitions) |
| `checklist_items` | Per-event instances (status, value, timestamps, due dates) |
| `checklist_corrections` | Audit trail for authorised date corrections |
| `tasks` | Automatic + manual tasks (idempotency_key for dedupe, source_rule) |
| `notification_rules` | Admin-configurable rules (module/field/trigger/interval/channel) |
| `notifications` | In-app + email notifications (read state, delivery tracking) |
| `documents` | File metadata (R2 key, category, event/venue link) |
| `event_activity` | Per-event activity feed |
| `daily_reports` | Immutable historical report snapshots |
| `dropdown_options` | All lookup lists (admin-editable) |
| `app_settings` | Admin settings (incl. Resend API key, encrypted) |

## Event status state machine

```
Draft → Inquiry → Availability Check → Awaiting Approval (VFH) → Waitlisted/Tentative → Confirmed → In Progress → Completed → Closed
                                                                                       ↓
                                                                                  Cancelled / Rejected
```

- Every transition recorded in `event_status_history` with reason.
- VFH approval section shown only when `event_type = 'VFH'`.
- "Save as Confirmed" gated on signed confirmation (+ approval if VFH).
- Cancelled from In Progress requires Admin/Venue Manager + mandatory reason.

## Checklist state machine (per item)

`Not Started → In Progress → Completed` with `Not Applicable` and `Blocked` side-states.

Automatic task rules (idempotent, deduplicated by `idempotency_key`):
- Approval Sent → task due +7 days ("Follow up on Approval")
- Costing instalment dates → task per instalment
- Confirmation Couriered → task due +3 days
- OnStage Asked Client → task due +3 days
- Technical Meeting date → task for that date
- Feedback Sent → task due +5 days
- File Sent to Accounts → task due +3 days
- 5 days after Event End with incomplete items → high-priority "Post-event checklist incomplete"

## Conflict detection

- Same venue, overlapping setup/rehearsal/show/dismantling:
  - Confirmed ∩ Confirmed = **Conflict**
  - Tentative overlaps = **Potential Conflict**
- Never auto-blocks; Admin/Venue Manager may override with reason.

## Seed data

Seeded from `Dropdown_Master` (venues, caterers, decorators, staff, statuses) and the transactional sheets (Enquiries 326, Confirmed 102, Tentative 20, Regrets 1). Seed is idempotent (upsert by natural keys) and clearly flagged as seed data.
