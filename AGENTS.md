# AGENTS.md

## Cursor Cloud specific instructions

NCPA Venue for Hire is an internal ops SPA (React 18 + Vite) backed by a Hono API
running on Cloudflare Pages Functions with D1 (SQLite) + R2. See `README.md` and
`CONTEXT.md` for architecture; standard scripts live in `package.json`.

### Running locally (two processes)
The API and SPA run as two separate dev servers:
- `npm run dev:api` — `wrangler pages dev dist ...` on `:8788` (local D1 + R2 + Functions).
  It serves the built `dist/`, so run `npm run build` at least once before starting it
  (and after changing SPA code you want reflected on `:8788` directly). The SPA at `:5173`
  itself hot-reloads without a rebuild since Vite serves it.
- `npm run dev` — Vite SPA on `:5173`, which proxies `/api` → `:8788`.
Use `http://localhost:5173` in the browser. Both need `.dev.vars` to exist (copy from
`.dev.vars.example`; set a random `SESSION_SECRET`). `RESEND_API_KEY` can stay blank —
email gracefully no-ops.

### Local database
Wrangler's local D1 lives under `.wrangler/state` (gitignored). The dev/seed/migrate
scripts all use this same default persist location, so they share one database. First-time
setup: `npm run db:migrate:local` then `npm run db:seed:local`. The seed loads dropdowns +
checklist definitions (required for the event form to render); it also tries to import an
Excel workbook (`../Excel Forms/…xlsx`) that is NOT in the repo — those sheets are skipped
with a warning, which is expected and harmless.

### Admin / login
`npm run bootstrap:admin` is interactive and hangs on piped stdin (readline/promises + EOF),
so it cannot be automated by piping answers. To create an admin non-interactively, insert
directly into local D1 using the same scrypt scheme as `scripts/bootstrap-admin.ts`
(`scrypt:<saltHex>:<hashHex>`, N=16384/r=8/p=1/dkLen=32, password `.normalize("NFKC")`) and
`ALL_PERMISSIONS` from `worker/lib/rbac`. Log in at `/login`.

A full-access admin is already seeded in the persisted local D1 (kept in the VM
snapshot): `admin@ncpa.test` / `CloudAdmin!2026`. Reuse it rather than recreating one.

### Checks
`npm run typecheck`, `npm run lint`, `npm run test` (vitest), `npm run build` — all match CI
(`.github/workflows/ci.yml`).
