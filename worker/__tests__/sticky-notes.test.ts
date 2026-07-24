import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { SESSION_COOKIE } from "../lib/sessions";

type StoredNote = {
  id: string;
  body: string;
  event_id: string | null;
  organisation_id: string | null;
  status: "active" | "archived";
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_by: string | null;
  archived_at: string | null;
};

type StoredLayout = { x: number; y: number; z_index: number; updated_at: string };

function stickyNotesDb() {
  const users = new Map([
    ["user_creator", { name: "Creator", email: "creator@example.com" }],
    ["user_other", { name: "Other teammate", email: "other@example.com" }],
  ]);
  const sessions = new Map([
    ["sess_creator", "user_creator"],
    ["sess_other", "user_other"],
  ]);
  const events = new Map([
    ["evt_one", { id: "evt_one", title: "TET Client Event", event_code: "EV-1", event_start_date: "2026-08-12", organisation_id: "org_one" }],
  ]);
  const organisations = new Map([
    ["org_one", { id: "org_one", name: "Example Client" }],
    ["org_two", { id: "org_two", name: "Second Client" }],
  ]);
  const notes = new Map<string, StoredNote>();
  const layouts = new Map<string, StoredLayout>();
  const audits: Array<{ action: string; targetId: string; detail: string | null }> = [];

  function rowFor(note: StoredNote, userId: string) {
    const event = note.event_id ? events.get(note.event_id) : null;
    const organisation = note.organisation_id ? organisations.get(note.organisation_id) : null;
    const creator = users.get(note.created_by)!;
    const archiver = note.archived_by ? users.get(note.archived_by) : null;
    const layout = layouts.get(`${note.id}:${userId}`);
    return {
      ...note,
      created_by_name: creator.name,
      archived_by_name: archiver?.name ?? null,
      event_title: event?.title ?? null,
      event_code: event?.event_code ?? null,
      event_start_date: event?.event_start_date ?? null,
      organisation_name: organisation?.name ?? null,
      layout_x: layout?.x ?? null,
      layout_y: layout?.y ?? null,
      layout_z_index: layout?.z_index ?? null,
    };
  }

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...nextArgs: unknown[]) {
          args = nextArgs;
          return statement;
        },
        async first() {
          if (sql.includes("FROM sessions s JOIN users")) {
            const userId = sessions.get(String(args[0]));
            const user = userId ? users.get(userId) : null;
            return userId && user ? {
              id: args[0],
              user_id: userId,
              csrf_token: "csrf",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              revoked_at: null,
              email: user.email,
              name: user.name,
              role: "admin",
              permissions: null,
              is_active: 1,
            } : null;
          }
          if (sql.includes("SELECT id, organisation_id FROM events")) {
            return events.get(String(args[0])) ?? null;
          }
          if (sql.includes("SELECT id FROM organisations")) {
            return organisations.get(String(args[0])) ?? null;
          }
          if (sql.includes("SELECT id, created_by, status, updated_at FROM sticky_notes")) {
            return notes.get(String(args[0])) ?? null;
          }
          if (sql.includes("FROM sticky_notes n") && sql.includes("WHERE n.id = ?")) {
            const note = notes.get(String(args[1]));
            return note ? rowFor(note, String(args[0])) : null;
          }
          if (sql.includes("COUNT(*) AS active_count")) {
            return { active_count: [...notes.values()].filter((note) => note.status === "active").length, newest_updated_at: null };
          }
          if (sql.includes("SELECT COUNT(*) AS total")) {
            const status = String(args[0]);
            return { total: [...notes.values()].filter((note) => note.status === status).length };
          }
          return null;
        },
        async all() {
          if (sql.includes("SELECT DISTINCT u.id, u.name")) {
            return { results: [...users].map(([id, user]) => ({ id, name: user.name })) };
          }
          if (sql.includes("FROM sticky_notes n") && sql.includes("LIMIT ? OFFSET ?")) {
            const userId = String(args[0]);
            const status = String(args[1]);
            return {
              results: [...notes.values()]
                .filter((note) => note.status === status)
                .map((note) => rowFor(note, userId)),
            };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes("INSERT INTO sticky_notes")) {
            const [id, body, eventId, organisationId, createdBy, createdAt, updatedAt] = args.map(String);
            notes.set(id!, {
              id: id!,
              body: body!,
              event_id: eventId === "null" ? null : eventId!,
              organisation_id: organisationId === "null" ? null : organisationId!,
              status: "active",
              created_by: createdBy!,
              created_at: createdAt!,
              updated_at: updatedAt!,
              archived_by: null,
              archived_at: null,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO sticky_note_layouts")) {
            const [noteId, userId, x, y, zIndex, updatedAt] = args;
            layouts.set(`${noteId}:${userId}`, {
              x: Number(x),
              y: Number(y),
              z_index: Number(zIndex),
              updated_at: String(updatedAt),
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("SET body = ?")) {
            const [body, updatedAt, noteId, expected] = args;
            const note = notes.get(String(noteId));
            if (!note || note.status !== "active" || note.updated_at !== expected) return { success: true, meta: { changes: 0 } };
            note.body = String(body);
            note.updated_at = String(updatedAt);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("SET event_id = ?")) {
            const [eventId, organisationId, updatedAt, noteId] = args;
            const note = notes.get(String(noteId));
            if (note) {
              note.event_id = eventId == null ? null : String(eventId);
              note.organisation_id = organisationId == null ? null : String(organisationId);
              note.updated_at = String(updatedAt);
            }
            return { success: true, meta: { changes: note ? 1 : 0 } };
          }
          if (sql.includes("SET status = 'archived'")) {
            const [archivedBy, archivedAt, updatedAt, noteId] = args;
            const note = notes.get(String(noteId));
            if (note) {
              note.status = "archived";
              note.archived_by = String(archivedBy);
              note.archived_at = String(archivedAt);
              note.updated_at = String(updatedAt);
            }
            return { success: true, meta: { changes: note ? 1 : 0 } };
          }
          if (sql.includes("SET status = 'active'")) {
            const [updatedAt, noteId] = args;
            const note = notes.get(String(noteId));
            if (note) {
              note.status = "active";
              note.archived_by = null;
              note.archived_at = null;
              note.updated_at = String(updatedAt);
            }
            return { success: true, meta: { changes: note ? 1 : 0 } };
          }
          if (sql.includes("DELETE FROM sticky_note_layouts")) {
            for (const key of layouts.keys()) if (key.startsWith(`${args[0]}:`)) layouts.delete(key);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM sticky_notes")) {
            const deleted = notes.delete(String(args[0]));
            return { success: true, meta: { changes: deleted ? 1 : 0 } };
          }
          if (sql.includes("INSERT INTO audit_logs")) {
            audits.push({
              action: String(args[3]),
              targetId: String(args[5]),
              detail: args[6] == null ? null : String(args[6]),
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;

  return { db, notes, layouts, audits };
}

function authenticated(path: string, session: "sess_creator" | "sess_other", init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cookie", `${SESSION_COOKIE}=${session}`);
  if (init?.body) headers.set("Content-Type", "application/json");
  return new Request(`http://example.test${path}`, { ...init, headers });
}

describe("sticky-note API", () => {
  it("requires authentication", async () => {
    const { db } = stickyNotesDb();
    const app = buildApp({ DB: db } as never);
    const response = await app.request("/sticky-notes/summary", {}, { DB: db } as never);
    expect(response.status).toBe(401);
  });

  it("enforces shared action rights, creator ownership, link consistency, and personal layouts", async () => {
    const { db, notes, layouts, audits } = stickyNotesDb();
    const app = buildApp({ DB: db } as never);

    const createResponse = await app.fetch(authenticated("/sticky-notes", "sess_creator", {
      method: "POST",
      body: JSON.stringify({
        body: "Change AC time to 18:30 in TET.",
        event_id: "evt_one",
        organisation_id: "org_two",
        layout: { x: 0.2, y: 0.3, z_index: 4 },
      }),
    }), { DB: db } as never);
    expect(createResponse.status).toBe(201);
    const createdBody = await createResponse.json() as { note: { id: string; organisation_id: string; layout: StoredLayout; updated_at: string } };
    const noteId = createdBody.note.id;
    expect(createdBody.note.organisation_id).toBe("org_one");
    expect(createdBody.note.layout).toMatchObject({ x: 0.2, y: 0.3, z_index: 4 });

    const forbiddenEdit = await app.fetch(authenticated(`/sticky-notes/${noteId}`, "sess_other", {
      method: "PATCH",
      body: JSON.stringify({ body: "Changed by somebody else", expected_updated_at: createdBody.note.updated_at }),
    }), { DB: db } as never);
    expect(forbiddenEdit.status).toBe(403);

    const forbiddenDelete = await app.fetch(authenticated(`/sticky-notes/${noteId}`, "sess_other", {
      method: "DELETE",
    }), { DB: db } as never);
    expect(forbiddenDelete.status).toBe(403);

    const archiveResponse = await app.fetch(authenticated(`/sticky-notes/${noteId}/archive`, "sess_other", {
      method: "POST",
    }), { DB: db } as never);
    expect(archiveResponse.status).toBe(200);
    const archived = await archiveResponse.json() as { note: { status: string; layout: StoredLayout | null; archived_by_name: string } };
    expect(archived.note).toMatchObject({ status: "archived", layout: null, archived_by_name: "Other teammate" });

    const editArchived = await app.fetch(authenticated(`/sticky-notes/${noteId}`, "sess_creator", {
      method: "PATCH",
      body: JSON.stringify({ body: "Cannot change archived note", expected_updated_at: notes.get(noteId)!.updated_at }),
    }), { DB: db } as never);
    expect(editArchived.status).toBe(409);

    const restoreResponse = await app.fetch(authenticated(`/sticky-notes/${noteId}/restore`, "sess_other", {
      method: "POST",
    }), { DB: db } as never);
    expect(restoreResponse.status).toBe(200);

    const relinkResponse = await app.fetch(authenticated(`/sticky-notes/${noteId}/link`, "sess_other", {
      method: "PUT",
      body: JSON.stringify({ event_id: null, organisation_id: "org_two" }),
    }), { DB: db } as never);
    expect(relinkResponse.status).toBe(200);
    expect(notes.get(noteId)).toMatchObject({ event_id: null, organisation_id: "org_two" });

    const otherLayoutResponse = await app.fetch(authenticated(`/sticky-notes/${noteId}/layout`, "sess_other", {
      method: "PUT",
      body: JSON.stringify({ x: 0.8, y: 0.7, z_index: 9 }),
    }), { DB: db } as never);
    expect(otherLayoutResponse.status).toBe(200);
    expect(layouts.get(`${noteId}:user_creator`)).toMatchObject({ x: 0.2, y: 0.3, z_index: 4 });
    expect(layouts.get(`${noteId}:user_other`)).toMatchObject({ x: 0.8, y: 0.7, z_index: 9 });

    const expectedUpdatedAt = notes.get(noteId)!.updated_at;
    const creatorEdit = await app.fetch(authenticated(`/sticky-notes/${noteId}`, "sess_creator", {
      method: "PATCH",
      body: JSON.stringify({ body: "Signing authority is XYZ.", expected_updated_at: expectedUpdatedAt }),
    }), { DB: db } as never);
    expect(creatorEdit.status).toBe(200);
    expect(notes.get(noteId)?.body).toBe("Signing authority is XYZ.");

    const deleteResponse = await app.fetch(authenticated(`/sticky-notes/${noteId}`, "sess_creator", {
      method: "DELETE",
    }), { DB: db } as never);
    expect(deleteResponse.status).toBe(200);
    expect(notes.has(noteId)).toBe(false);
    expect(audits.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "sticky_note.created",
      "sticky_note.archived",
      "sticky_note.restored",
      "sticky_note.relinked",
      "sticky_note.edited",
      "sticky_note.deleted",
    ]));
    expect(audits.find((entry) => entry.action === "sticky_note.deleted")?.detail).toBeNull();
  });
});
