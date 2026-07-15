# NCPA Venue for Hire

An internal operations application for the NCPA Venue for Hire team — managing the full event lifecycle from inquiry through approval, confirmation, planning, checklists, accounts tracking, notifications, daily operations, and post-event closure.

> **Internal operations tool.** Not a public booking portal. No online payments, no client portal, no invoice generation.

---

## What this app does

One central workspace where the team can answer, within a minute of opening it:

- What events are currently being handled, and at what stage
- Which venues are occupied or potentially occupied
- What is happening today, what needs attention, what is overdue
- Who is responsible, what is complete, what remains incomplete

Built strictly from the supplied NCPA source materials (event form mockup, operations/accounts checklists, executive event tracker, calendar mockup, and the product spec). No invented fields, workflows, or integrations.

## Architecture

```
Browser (React SPA)  ──►  Cloudflare Pages  ──►  Pages Functions (/api/**)  ──►  Hono API
                              │                        │
                              │                        ├── D1 (SQLite)  — binding: DB
                              │                        └── R2 (files)   — binding: FILES
                              │
Cron Worker (ncpa-hire-scheduler) ──► D1 (shared)     scheduled jobs: tasks, notifications, overdue, post-event
```

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind (Marble + Sage design system) |
| API | Hono on Cloudflare Workers/Pages |
| Database | Cloudflare D1 (SQLite) |
| File storage | Cloudflare R2 |
| Auth | email + password (scrypt) + TOTP MFA + RBAC + sessions |
| Email | Resend (graceful no-op until configured) |
| Scheduler | Cloudflare Cron Triggers |

See **ARCHITECTURE.md** for the full design.

## Cloudflare resources

| Resource | Name | Binding |
|---|---|---|
| Pages project | `ncpa-hire` | — |
| D1 database | `ncpa-hire-db` | `DB` |
| R2 bucket | `ncpa-hire-files` | `FILES` |
| Cron Worker | `ncpa-hire-scheduler` | — |

Production URL: **https://ncpa-hire.pages.dev**

## Prerequisites

- Node.js ≥ 20
- npm (lockfile committed)
- Cloudflare account (wrangler authenticated)
- (Optional) GitHub CLI `gh` authenticated, for repo secrets

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the secrets template and fill in local values
cp .dev.vars.example .dev.vars
#   - SESSION_SECRET: any long random string for local dev
#   - RESEND_API_KEY: leave blank to no-op email (logs instead)

# 3. Apply local D1 migrations
npm run db:migrate:local

# 4. (Optional) Seed local D1 with the supplied Excel data
npm run db:seed:local

# 5. Start the API (local D1/R2 via wrangler pages dev) on :8788
npm run dev:api

# 6. In another terminal, start the Vite SPA on :5173 (proxies /api → :8788)
npm run dev
```

Open http://localhost:5173.

## Common scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite SPA dev server (proxies `/api` to the API) |
| `npm run dev:api` | wrangler pages dev (local D1 + R2 + Functions) |
| `npm run build` | Type-check + build SPA to `dist/` |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit/integration tests |
| `npm run db:migrate:local` | Apply D1 migrations locally |
| `npm run db:migrate:remote` | Apply D1 migrations to production |
| `npm run db:seed:local` | Seed local D1 from the Excel workbook |
| `npm run db:seed:preview` | Seed preview environment (opt-in, never auto on prod) |
| `npm run bootstrap:admin` | One-time first-Admin creation |
| `npm run deploy` | Build + deploy SPA to Cloudflare Pages |
| `npm run deploy:scheduler` | Deploy the cron Worker |

## Local secrets

`.dev.vars` is **gitignored** and never committed. Required values:

- `SESSION_SECRET` — random string for signing sessions
- `RESEND_API_KEY` — optional; leave blank to no-op email
- `MAIL_FROM` — from address (verified domain in Resend)
- `APP_URL` — used for email links / audit

In production, secrets are set via the Cloudflare dashboard or `wrangler pages secret put`, **not** in the repo. The Resend API key can alternatively be configured at runtime via the admin **Settings** UI (stored encrypted in D1, with a configured-check).

## Deployment

Production deploys via GitHub Actions on push to `main` (`.github/workflows/ci.yml`):

1. **Validate** — typecheck, lint, test, build
2. **Deploy** (runs only after validate passes on `main`) — apply D1 migrations, deploy Pages, deploy scheduler

Manual production deploy: Actions → **CI** → **Run workflow** (branch: `main`).

### Required GitHub repository secrets

| Secret name | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (deploy + D1) |
| `CLOUDFLARE_ACC_ID` | Cloudflare account ID |

> Note: the variable is named `CLOUDFLARE_ACC_ID` per project convention and mapped to the Cloudflare account ID wherever required.

## Resend (email)

Email notifications use [Resend](https://resend.com). Configure via either:

- `RESEND_API_KEY` in `.dev.vars` (local) / Cloudflare secret (production), **or**
- The admin **Settings → Email** UI, which stores the key and runs a configured-check.

Until a key is present, email sending gracefully no-ops (delivery is logged). In-app notifications work regardless.

## Creating the first Admin

```bash
npm run bootstrap:admin
```

Follow the prompts. No default production credentials live in the repository.

## Troubleshooting

| Problem | Fix |
|---|---|
| `wrangler` not authenticated | Run `wrangler login` |
| Local D1 missing | Run `npm run db:migrate:local` |
| SPA can't reach API | Ensure `npm run dev:api` is running on :8788 |
| Email not sending | Check `RESEND_API_KEY` / Settings → Email configured-check |
| Deploy fails on secrets | Add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACC_ID` to GitHub secrets |

See **DEPLOYMENT.md** and **TESTING.md** for detail.
