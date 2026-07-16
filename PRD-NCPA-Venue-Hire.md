# Product Requirements Document (PRD)
## NCPA Venue for Hire — Internal Operations Application

| Field | Value |
|---|---|
| **Product name** | NCPA Venue for Hire (hire-flow-ncpa) |
| **Version** | 1.0 (as implemented) |
| **Audience** | QA / automated testing (including TestSprite) |
| **Production URL** | https://ncpa-hire.pages.dev |
| **Local URL** | http://localhost:5173 (API proxied to :8788) |
| **Document type** | Product Requirements + Testable Acceptance Criteria |
| **Last updated** | 2026-07-10 |

---

## 1. Product overview

### 1.1 Purpose
An **internal operations tool** for the National Centre for the Performing Arts (NCPA) Venue for Hire team. It manages the full event lifecycle from enquiry through approval, confirmation, operations/accounts checklists, tasks, documents, calendar, daily reports, and post-event closure.

### 1.2 Problem it solves
Staff must answer, within about one minute of opening the app:

- What events are active, and at what lifecycle stage?
- Which venues are occupied or potentially occupied?
- What needs attention today / is overdue?
- Who owns each item, what is complete, what remains?

### 1.3 Explicitly out of scope
- Public / client-facing booking portal
- Online payments / payment gateway
- Invoice generation
- External client self-service accounts

### 1.4 Primary users (roles)

| Role | Intent |
|---|---|
| **Admin** | Full access; user management; settings; overrides |
| **Venue Manager** | All events; status changes; conflict override; reports/analytics |
| **Coordinator** | Create events; edit assigned work; checklists; tasks; documents |
| **Viewer** | Read-only events and reports |

Permissions are enforced **server-side** and mirrored in the UI (hide/disable).

---

## 2. Environments & access

### 2.1 URLs
| Environment | Base URL |
|---|---|
| Production | `https://ncpa-hire.pages.dev` |
| Local SPA | `http://localhost:5173` |
| Local API | `http://localhost:8788` (via `/api` proxy from SPA) |

### 2.2 Authentication
1. Email + password login (`/login`)
2. Optional TOTP MFA (if enrolled) → MFA challenge before session
3. Session cookie (httpOnly)
4. Password reset: `/forgot-password` → `/reset-password`
5. Profile: change password, set up/disable MFA (`/profile`)

**Test note:** Use a provisioned test user. Do not invent credentials in automated runs without a known seed/bootstrap admin.

### 2.3 Protected vs public routes

| Public | Authenticated (RequireAuth + AppShell) |
|---|---|
| `/login` | `/dashboard` |
| `/forgot-password` | `/calendar` |
| `/reset-password` | `/events/new`, `/events/:id`, `/events/:id/edit` |
| | `/organisations`, `/tasks`, `/reports` |
| | `/settings`, `/admin/users`, `/profile` |

- Unauthenticated access to protected routes → redirect to `/login`
- `/` and unknown paths → `/dashboard` (when authenticated)
- `/events` (list) → redirects to `/calendar` (Calendar is the hub)

---

## 3. Domain model (test-relevant)

```
Organisation
├── Contacts (1:N)
└── Event
    ├── VenueBookings (1:N)
    │   └── ScheduleEntries (1:N)  — setup / rehearsal / show / dismantling / technical_meeting
    ├── ChecklistItems (operations + accounts)
    ├── Tasks (automatic + manual)
    ├── Documents (metadata in DB; files in R2)
    ├── Notifications
    └── EventActivity (audit feed)
```

### 3.1 Event types
`EE` | `FR` | `VFH` | `Free Event`

- **VFH** events include an Approval checklist section (`vfh_only` fields).
- Non-VFH events do not show Approval fields.

### 3.2 Event statuses (canonical)
```
enquiry → tentative → approved (VFH only) → confirmed
         ↘ regret / cancelled (terminal; reopen requires override + reason)
```

| Status | Meaning |
|---|---|
| Enquiry | Initial inquiry |
| Tentative | Client uncertain; holding / follow-up (not a normal “next milestone”) |
| Approved | VFH approval gate passed |
| Confirmed | Booking confirmed (gated — see §5) |
| Regret | Declined before confirmation |
| Cancelled | Booking called off |

---

## 4. Feature requirements by area

### 4.1 Login & session
| ID | Requirement | Acceptance criteria |
|---|---|---|
| AUTH-01 | User can log in with email/password | Valid credentials → session + redirect to app |
| AUTH-02 | Invalid credentials rejected | Error shown; no session |
| AUTH-03 | MFA enrolled users must complete MFA | After password, MFA step required before app access |
| AUTH-04 | Logout ends session | Subsequent protected navigation requires login |
| AUTH-05 | Forgot/reset password flow works | Request reset → use token page → new password usable |

### 4.2 Dashboard
| ID | Requirement | Acceptance criteria |
|---|---|---|
| DASH-01 | Dashboard shows lifecycle status counts | Counts visible for key statuses |
| DASH-02 | Actionable tasks / lifecycle queue surfaced | User can navigate from dashboard items into events/tasks |
| DASH-03 | Default landing after login | Authenticated `/` lands on `/dashboard` |

### 4.2a Application shell
| ID | Requirement | Acceptance criteria |
|---|---|---|
| SHELL-01 | Persistent desktop/tablet navigation | Navigating between authenticated pages retains the left navigation shell |
| SHELL-02 | Decorative sidebar botanical | A sage vine appears below the desktop/tablet navigation, fills the remaining sidebar height, is non-interactive and `aria-hidden`, and is omitted from the mobile drawer |

### 4.3 Calendar (primary hub)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CAL-01 | Calendar is the event activity hub | `/events` redirects to `/calendar` |
| CAL-02 | Schedule view shows venue/time occupancy | Entries visible for booked venues/dates |
| CAL-03 | Lifecycle / milestone view available | Events shown by lifecycle context |
| CAL-04 | Filters by date, status, venue, owner | Changing filters updates visible set |
| CAL-05 | Detail panel / navigation to event | Selecting an event opens detail or panel with event info |
| CAL-06 | Overflow / hidden lifecycle records openable | Month-grid overflow can open hidden records |

### 4.4 Create / edit event
| ID | Requirement | Acceptance criteria |
|---|---|---|
| EVT-01 | Create event via wizard | `/events/new` multi-step: Client → Venues & Schedule → Requirements → Documents → Review |
| EVT-02 | Edit existing event | `/events/:id/edit` loads and saves changes |
| EVT-03 | Organisation can be selected or typed | Free-text organisation names are accepted where designed |
| EVT-04 | Duplicate detection before save | Overlapping org + date + title + venues blocks/warns appropriately |
| EVT-05 | Venue bookings + schedule entries required structure | At least one venue/schedule path can be saved for a valid event |
| EVT-06 | Event type shown on detail | Detail page displays event type |
| EVT-07 | Dates display day-first (IST context) | UI dates are day-first; timezone display Asia/Kolkata |

### 4.5 Event detail & lifecycle
| ID | Requirement | Acceptance criteria |
|---|---|---|
| DET-01 | Detail tabs available | Overview, Operations, Accounts, Tasks, Documents, Venues, Conflicts, Activity |
| DET-02 | Lifecycle panel shows current status | Status badge + next milestone / blocked state |
| DET-03 | Forward status actions when allowed | Eligible roles can advance when gates pass |
| DET-04 | Close-out actions | Mark as Regret / Cancel event available when allowed |
| DET-05 | Blockers deep-link to checklist fields | Clicking a blocker (e.g. “Payment must be completed.”) opens Operations and focuses the field |
| DET-06 | Confirmation blocked until gates met | See §5; UI shows “Confirmed is blocked” + next blocker |
| DET-07 | Override transitions need reason | Cancel confirmed / reopen terminal requires override role + reason |

### 4.6 Operations checklist
| ID | Requirement | Acceptance criteria |
|---|---|---|
| OPS-01 | Operations checklist sections render | Sections include Point of Contact, Approval (VFH), Event Dates, Timings, Financials, Confirmation Letter, Additional Requirements, etc. |
| OPS-02 | Checklist edits persist | Changing a field updates value/status and survives refresh |
| OPS-03 | Financials gate fields | Costing Email (`No`/`Yes`), Payment Status (`Incomplete`/`Completed`) |
| OPS-04 | Instalment conditional fields | Installment date fields visible only when Instalment = Yes |
| OPS-05 | Confirmation letter progression | Made → Couriered → Signed Copy Received drives confirmation_status |
| OPS-06 | Completion rollups update | Ops completion % reflects completed / not_applicable items |

#### 4.6.1 VFH Approval section (critical)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| VFH-01 | Approval section only for VFH | Non-VFH events do not show Approval fields |
| VFH-02 | Approval Required? default | Default is **Not Required** |
| VFH-03 | When Not Required, skip dependents | **Approval Sent On**, **Approval Received On**, and **Genre Head** are **hidden** |
| VFH-04 | Dependents marked not applicable | Those three fields have status `not_applicable` when Not Required |
| VFH-05 | When Required, dependents visible | Switching to Required shows Sent On, Received On, Genre Head |
| VFH-06 | Not Required does not block confirm | VFH with approval Not Required can confirm if other gates pass |
| VFH-07 | Required without received blocks confirm | VFH with approval Required and not received/approved cannot confirm |
| VFH-08 | Approval follow-up tasks close on Not Required | Open approval_followup tasks complete when set to Not Required |

### 4.7 Accounts checklist
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ACC-01 | Accounts module visible on Accounts tab | Accounts sections/fields load for the event |
| ACC-02 | Edits persist and affect accounts completion | Status/value updates reflected in completion |

### 4.8 Tasks
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TASK-01 | Tasks inbox lists open work | `/tasks` shows filterable tasks |
| TASK-02 | Automatic tasks from checklist rules | e.g. approval follow-up, confirmation letter, instalment |
| TASK-03 | Manual task create (permitted roles) | Task can be created and appears in list |
| TASK-04 | Complete task | Status becomes completed |
| TASK-05 | Deep link from task to event field/tab | Opening a task navigates to relevant event context |
| TASK-06 | Due label (not “Target”) | UI uses **Due** for task due dates |
| TASK-07 | Event cards do not duplicate due date noise | Redundant due date not repeated on task lines inside event cards |

### 4.9 Documents
| ID | Requirement | Acceptance criteria |
|---|---|---|
| DOC-01 | Upload document to event | File appears in Documents tab |
| DOC-02 | Download document | File downloads successfully |
| DOC-03 | Delete document (permitted roles) | Document removed / archived per rules |
| DOC-04 | Size/category constraints enforced | Oversized or invalid uploads rejected with error |

### 4.10 Organisations
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ORG-01 | Organisations directory | `/organisations` lists clients with filters |
| ORG-02 | Faceted / filter-first UI | Filters narrow the organisation list |
| ORG-03 | Contacts associated with organisations | Contacts viewable/editable per permissions |

### 4.11 Reports & analytics
| ID | Requirement | Acceptance criteria |
|---|---|---|
| RPT-01 | Daily report generation | User can generate/list daily reports |
| RPT-02 | Export formats | XLSX and/or PDF export available where implemented |
| RPT-03 | Analytics views | Venue utilisation, inquiry conversion, payment tracking, operational performance, client profile |

### 4.12 Settings & admin
| ID | Requirement | Acceptance criteria |
|---|---|---|
| SET-01 | Settings (admin) | Email/Resend config, master lists, event owner accounts |
| USR-01 | User management (admin only) | Create/edit users, assign roles, admin password reset |
| USR-02 | Non-admin cannot access `/admin/users` | Redirect or denied |
| PRF-01 | Profile self-service | Password change + MFA setup |

### 4.13 Notifications
| ID | Requirement | Acceptance criteria |
|---|---|---|
| NOT-01 | In-app notifications | Bell/inbox shows notifications |
| NOT-02 | Mark read | Notification can be marked read |
| NOT-03 | Email optional | Without Resend configured, email no-ops; in-app still works |

---

## 5. Confirmation business rules (must test)

An event may move to **Confirmed** only when **all** apply:

1. **Costing Email** checklist = `Yes`
2. **Payment Status** checklist = `Completed`
3. **Confirmation letter** signed received (`confirmation_status = signed_received`)
4. If **event_type = VFH**:
   - Either `approval_status = not_required` (Approval Required? = Not Required), **or**
   - `approval_status` is `received` or `approved`

**UI behaviour when blocked**
- Lifecycle shows “Confirmed is blocked”
- Next blocker message shown (ordered)
- Blocker text is a **link** to the relevant Operations checklist field, e.g.:
  - “Payment must be completed.” → Payment Status
  - “Costing email must be sent.” → Costing Email
  - Confirmation letter blockers → Made / Couriered / Signed Copy
  - VFH approval blockers → Approval Received On

---

## 6. Navigation map (for E2E agents)

```
/login
  └─► /dashboard
        ├─► /calendar          (hub)
        ├─► /events/new        (create wizard)
        ├─► /events/:id        (detail + lifecycle + checklists)
        ├─► /events/:id/edit
        ├─► /tasks
        ├─► /organisations
        ├─► /reports
        ├─► /settings          (admin)
        ├─► /admin/users       (admin)
        └─► /profile
```

Sidebar (typical): Dashboard → Tasks → Calendar → Regrets → Reports → Organisations → Settings
User menu: Profile, User Management (admin), notifications.

On desktop and tablet, the sidebar also contains a display-only sage botanical below the navigation card. It softly fades into the Marble + Sage background and must never carry workflow information, replace a navigation item, or appear in the compact mobile drawer.

---

## 7. Suggested TestSprite / E2E test suites

### Suite A — Smoke (authenticated)
1. Login succeeds  
2. Dashboard loads  
3. Calendar loads  
4. Open an existing event detail  
5. Logout  

### Suite B — Event create
1. Create VFH event with organisation, venue, schedule  
2. Save succeeds  
3. Event appears on calendar / detail  
4. Duplicate attempt with same org/date/title/venues is blocked or warned  

### Suite C — Confirmation gates
1. Event missing payment → Confirmed blocked; blocker links to Payment Status  
2. Set Costing Email = Yes, Payment = Completed, signed confirmation  
3. Non-VFH → can confirm  
4. VFH + Approval Not Required → can confirm without approval dates  
5. VFH + Approval Required without received → cannot confirm  

### Suite D — VFH Approval skip
1. Open VFH event  
2. Set Approval Required? = Not Required  
3. Assert Sent On / Received On / Genre Head **not visible**  
4. Set Approval Required? = Required  
5. Assert those three fields **visible** again  

### Suite E — RBAC
1. Viewer cannot edit checklist / change status / open user admin  
2. Coordinator can create event and update checklist  
3. Venue Manager / Admin can change status and override  

### Suite F — Tasks & documents
1. Trigger checklist that creates a follow-up task  
2. Complete task  
3. Upload and download a document  

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Server-side RBAC; httpOnly sessions; password hashing (scrypt); optional TOTP |
| Data | Cloudflare D1 (SQLite); R2 for files; ephemeral local FS not used for durable data |
| Timezone | Display/context `Asia/Kolkata`; store timestamps ISO-8601 UTC |
| Date UI | Day-first formatting on frontend |
| Browser | Modern evergreen browsers |
| Performance | Core screens usable within ~1 minute for operational questions |
| Accessibility | Decorative artwork is `aria-hidden`; navigation labels and controls remain accessible without relying on colour or decoration |

---

## 9. Tech stack (context for tooling)

- Frontend: React 18, Vite, React Router, TanStack Query, Tailwind  
- API: Hono on Cloudflare Pages Functions (`/api/**`)  
- DB: Cloudflare D1 (raw SQL, migrations)  
- Files: Cloudflare R2  
- Jobs: Cloudflare Worker cron (~30 min)  
- Email: Resend (optional)  

---

## 10. Test data guidance

- Prefer seeded / demo events over inventing production data  
- Bootstrap an admin locally via `npm run bootstrap:admin` when testing local  
- For production TestSprite runs, use a dedicated test account (never share real staff MFA secrets in docs)  
- VFH vs non-VFH fixtures are required for Suites C and D  

---

## 11. Known product behaviours testers should not treat as bugs

1. `/events` list route intentionally redirects to Calendar  
2. Tentative is a holding state, not the default “next” milestone from enquiry  
3. Instalment = Yes shows installment dates; Instalment itself does **not** gate confirmation  
4. Approval dependents are skipped only when Approval Required? = Not Required (VFH)  
5. Email may silently no-op if Resend is unconfigured; in-app notifications still work  
6. Confirmation gates read **checklist** values (costing/payment), not separate event finance columns  

---

## 12. Traceability — recent product rules (2026-07)

| Rule | Behaviour |
|---|---|
| Lifecycle blocker links | Blocker copy is clickable → Operations field focus |
| Payment blocker copy | Exactly: `Payment must be completed.` |
| VFH approval skip | Not Required hides + N/A for Sent On, Received On, Genre Head |
| Task due wording | Label is Due (not Target) |

---

## 13. Success definition

The product is ready for operational use when:

1. Authenticated staff can create and progress events through the lifecycle with correct gates  
2. Calendar accurately reflects venue schedule and lifecycle state  
3. Checklists, tasks, and documents keep a single operational source of truth  
4. Role permissions prevent unauthorized mutations  
5. Confirmation cannot be granted without financial + confirmation (+ VFH approval unless Not Required) gates  

---

*End of PRD*
