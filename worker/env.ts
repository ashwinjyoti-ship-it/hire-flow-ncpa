/**
 * Shared Cloudflare environment bindings.
 * Declared consistently across wrangler.jsonc (Pages), scheduler/wrangler.jsonc,
 * and application code — per the spec's binding-naming requirement.
 */
export interface Env {
  // D1 binding (DB)
  DB: D1Database;
  // R2 binding (FILES)
  FILES: R2Bucket;

  // Non-secret vars
  APP_URL: string;
  MAIL_FROM: string;
  TZ: string;

  // Secrets (present in production via dashboard / .dev.vars locally)
  SESSION_SECRET: string;
  RESEND_API_KEY?: string;
  // Optional runtime override for Resend key set via admin Settings UI.
  // Stored encrypted in app_settings; resolved at send time.
}

/** Request-scoped context passed through middleware into handlers. */
export interface AppContext {
  env: Env;
  db: D1Database;
  files: R2Bucket;
  user: AuthUser | null;
}

/** The authenticated principal attached to a request (never the password/secret). */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organisation: string | null;
}

export type UserRole = "admin" | "venue_manager" | "coordinator" | "viewer";
