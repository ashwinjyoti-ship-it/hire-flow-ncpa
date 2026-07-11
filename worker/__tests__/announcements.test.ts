/**
 * Team announcement (pinned Dashboard message): only one is ever live,
 * posting a new one replaces it, dismissal is per-user, admin-only to
 * post/clear, and expired rows drop out of "active" on their own.
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { SESSION_COOKIE } from "../lib/sessions";

type AnnouncementRow = {
  id: string;
  message: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
};

type SessionUser = { user_id: string; role: string; name: string; email: string };

const SESSIONS: Record<string, SessionUser> = {
  sess_admin: { user_id: "user_admin", role: "admin", name: "Admin User", email: "admin@example.com" },
  sess_viewer: { user_id: "user_viewer", role: "viewer", name: "Viewer One", email: "viewer1@example.com" },
  sess_viewer2: { user_id: "user_viewer2", role: "viewer", name: "Viewer Two", email: "viewer2@example.com" },
};

function makeApp() {
  const announcements: AnnouncementRow[] = [];
  const dismissals = new Set<string>();

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM sessions")) {
                const s = SESSIONS[args[0] as string];
                if (!s) return null;
                return {
                  id: args[0], user_id: s.user_id, csrf_token: "csrf",
                  expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null,
                  email: s.email, name: s.name, role: s.role, is_active: 1,
                };
              }
              if (sql.includes("FROM announcements a LEFT JOIN users")) {
                const now = args[0] as string;
                const live = announcements
                  .filter((a) => !a.cleared_at && (!a.expires_at || a.expires_at > now))
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
                if (!live) return null;
                const creator = Object.values(SESSIONS).find((s) => s.user_id === live.created_by);
                return {
                  id: live.id, message: live.message, created_by: live.created_by,
                  created_at: live.created_at, expires_at: live.expires_at,
                  created_by_name: creator?.name ?? null,
                };
              }
              if (sql.includes("FROM announcement_dismissals WHERE announcement_id")) {
                const [annId, userId] = args as [string, string];
                return dismissals.has(`${annId}:${userId}`) ? { found: 1 } : null;
              }
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              if (sql.startsWith("UPDATE announcements SET cleared_at = ?, cleared_by = ? WHERE cleared_at IS NULL")) {
                const [clearedAt, clearedBy] = args as [string, string];
                for (const a of announcements) if (!a.cleared_at) { a.cleared_at = clearedAt; a.cleared_by = clearedBy; }
                return { success: true };
              }
              if (sql.startsWith("UPDATE announcements SET cleared_at = ?, cleared_by = ? WHERE id = ?")) {
                const [clearedAt, clearedBy, id] = args as [string, string, string];
                const row = announcements.find((a) => a.id === id);
                if (row) { row.cleared_at = clearedAt; row.cleared_by = clearedBy; }
                return { success: true };
              }
              if (sql.startsWith("INSERT INTO announcements")) {
                const [id, message, createdBy, createdAt, expiresAt] = args as [string, string, string, string, string | null];
                announcements.push({ id, message, created_by: createdBy, created_at: createdAt, expires_at: expiresAt, cleared_at: null, cleared_by: null });
                return { success: true };
              }
              if (sql.startsWith("INSERT OR IGNORE INTO announcement_dismissals")) {
                const [annId, userId] = args as [string, string];
                dismissals.add(`${annId}:${userId}`);
                return { success: true };
              }
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  const env = { DB: db, FILES: {} } as never;
  return { app: buildApp(env), env, announcements };
}

function cookieFor(session: keyof typeof SESSIONS) {
  return { Cookie: `${SESSION_COOKIE}=${session}` };
}

describe("team announcement", () => {
  it("has nothing live before anything is posted", async () => {
    const { app, env } = makeApp();
    const res = await app.request("/announcements/active", { headers: cookieFor("sess_viewer") }, env);
    expect(res.status).toBe(200);
    expect((await res.json() as { announcement: unknown }).announcement).toBeNull();
  });

  it("lets an admin post an announcement that becomes visible to everyone", async () => {
    const { app, env } = makeApp();
    const post = await app.request("/announcements", {
      method: "POST", headers: { ...cookieFor("sess_admin"), "Content-Type": "application/json" },
      body: JSON.stringify({ message: "No evening bookings this week." }),
    }, env);
    expect(post.status).toBe(201);

    const seen = await app.request("/announcements/active", { headers: cookieFor("sess_viewer") }, env);
    const body = await seen.json() as { announcement: { message: string; dismissed_by_me: boolean; created_by_name: string } };
    expect(body.announcement.message).toBe("No evening bookings this week.");
    expect(body.announcement.dismissed_by_me).toBe(false);
    expect(body.announcement.created_by_name).toBe("Admin User");
  });

  it("rejects posting and clearing from a non-privileged role", async () => {
    const { app, env } = makeApp();
    const post = await app.request("/announcements", {
      method: "POST", headers: { ...cookieFor("sess_viewer"), "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Should not work" }),
    }, env);
    expect(post.status).toBe(403);

    const clear = await app.request("/announcements/active", { method: "DELETE", headers: cookieFor("sess_viewer") }, env);
    expect(clear.status).toBe(403);
  });

  it("replaces the live announcement instead of stacking them", async () => {
    const { app, env } = makeApp();
    await app.request("/announcements", {
      method: "POST", headers: { ...cookieFor("sess_admin"), "Content-Type": "application/json" },
      body: JSON.stringify({ message: "First message" }),
    }, env);
    await app.request("/announcements", {
      method: "POST", headers: { ...cookieFor("sess_admin"), "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Second message" }),
    }, env);

    const res = await app.request("/announcements/active", { headers: cookieFor("sess_viewer") }, env);
    const body = await res.json() as { announcement: { message: string } };
    expect(body.announcement.message).toBe("Second message");
  });

  it("dismisses per-user without affecting other viewers", async () => {
    const { app, env } = makeApp();
    const post = await app.request("/announcements", {
      method: "POST", headers: { ...cookieFor("sess_admin"), "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Heads up" }),
    }, env);
    const { announcement } = await post.json() as { announcement: { id: string } };

    await app.request(`/announcements/${announcement.id}/dismiss`, { method: "POST", headers: cookieFor("sess_viewer") }, env);

    const mine = await app.request("/announcements/active", { headers: cookieFor("sess_viewer") }, env);
    expect((await mine.json() as { announcement: { dismissed_by_me: boolean } }).announcement.dismissed_by_me).toBe(true);

    const theirs = await app.request("/announcements/active", { headers: cookieFor("sess_viewer2") }, env);
    expect((await theirs.json() as { announcement: { dismissed_by_me: boolean } }).announcement.dismissed_by_me).toBe(false);
  });

  it("lets an admin clear the live announcement early", async () => {
    const { app, env } = makeApp();
    await app.request("/announcements", {
      method: "POST", headers: { ...cookieFor("sess_admin"), "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Temporary note" }),
    }, env);
    const clear = await app.request("/announcements/active", { method: "DELETE", headers: cookieFor("sess_admin") }, env);
    expect(clear.status).toBe(200);
    expect(await clear.json()).toEqual({ ok: true, cleared: true });

    const res = await app.request("/announcements/active", { headers: cookieFor("sess_viewer") }, env);
    expect((await res.json() as { announcement: unknown }).announcement).toBeNull();
  });

  it("drops an expired announcement from active without needing to clear it", async () => {
    const { app, env, announcements } = makeApp();
    announcements.push({
      id: "ann_expired", message: "Old news", created_by: "user_admin",
      created_at: new Date(Date.now() - 100_000).toISOString(),
      expires_at: new Date(Date.now() - 1_000).toISOString(),
      cleared_at: null, cleared_by: null,
    });
    const res = await app.request("/announcements/active", { headers: cookieFor("sess_viewer") }, env);
    expect((await res.json() as { announcement: unknown }).announcement).toBeNull();
  });

  it("rejects an empty message", async () => {
    const { app, env } = makeApp();
    const res = await app.request("/announcements", {
      method: "POST", headers: { ...cookieFor("sess_admin"), "Content-Type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    }, env);
    expect(res.status).toBe(400);
  });
});
