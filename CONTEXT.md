# CONTEXT — NCPA Venue for Hire

Internal ops tool for NCPA Venue for Hire. **Not** a public booking portal (no payments, invoices, or client portal).

**Repo:** `hire-flow-ncpa` · **Prod:** https://ncpa-hire.pages.dev · **PRD:** `PRD-NCPA-Venue-Hire.md`

## Stack
React 18 + Vite + TanStack Query + Tailwind → Hono API on Cloudflare Pages Functions (`/api/**`) → D1 (raw SQL) + R2. Cron worker every ~30m. Auth: email/password + optional TOTP. Email: Resend (optional no-op).

## Layout
| Path | Role |
|---|---|
| `src/` | SPA (pages, components, client libs) |
| `worker/` | API routes + domain logic |
| `functions/api/[[route]].ts` | Pages entry → Hono |
| `migrations/` | D1 SQL |
| `scheduler/` | Cron worker |
| `scripts/seed/` | Dropdowns, checklists, Excel import |

## Domain
`Organisation → Event → VenueBookings → ScheduleEntries`  
Also: ChecklistItems (ops + accounts), Tasks, Documents (R2), Notifications, Activity.

**Event types:** EE | FR | VFH | Free Event  
**Statuses:** enquiry → tentative → approved (VFH only) → confirmed · terminal: regret / cancelled  
**Roles:** admin · venue_manager · coordinator · viewer

## Key routes
Public: `/login`, `/forgot-password`, `/reset-password`  
App: `/dashboard`, `/calendar` (hub; `/events` redirects here), `/events/new|:id|:id/edit`, `/tasks`, `/organisations`, `/reports`, `/settings`, `/admin/users`, `/profile`

## Business rules (easy to break)
1. **Confirm gates:** Costing Email=Yes + Payment Status=Completed + signed confirmation; VFH also needs approval received/approved **unless** Approval Required?=Not Required.
2. **Blockers** deep-link to Operations checklist fields (`src/lib/lifecycle-blocker-targets.ts`).
3. **VFH + Not Required:** hide + mark N/A: Approval Sent On, Received On, Genre Head (`onlyWhen(approval_required == Required)`).
4. **Calendar is the hub** — no separate events list page.
5. Frontend imports `worker/` types directly. No ORM — schema = migrations + hand-written SQL.
6. Dates: day-first UI, display TZ `Asia/Kolkata`, store ISO UTC.

## Touch files first
`src/App.tsx` · `worker/app.ts` · `worker/lib/state-machine.ts` · `worker/lib/operations.ts` · `worker/lib/types.ts` · `worker/lib/rbac.ts` · `migrations/0001_init.sql`

## Local
```bash
npm i && cp .dev.vars.example .dev.vars
npm run db:migrate:local   # optional: db:seed:local, bootstrap:admin
npm run build && npm run dev:api   # :8788
npm run dev                        # :5173
```

## Deploy
Push to `main` → GitHub Actions. Migrations: `npm run db:migrate:remote`. Scheduler: separate `deploy:scheduler`.
