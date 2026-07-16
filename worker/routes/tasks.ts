import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../middleware/auth";
import { actorFrom, requirePermission, requireUser } from "../middleware/auth";
import { audit, eventActivity } from "../lib/audit";
import { makeId } from "../lib/id";
import { can } from "../lib/rbac";
import { IsoDate } from "../lib/types";
import { calculateEventFormReadiness } from "../lib/event-readiness";

export const taskRoutes = new Hono<AuthEnv>();

const TaskInput = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  event_id: z.string().nullish(),
  venue_booking_id: z.string().nullish(),
  assignee_id: z.string().nullish(),
  due_date: IsoDate.nullish(),
  due_time: z.string().nullish(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
});

taskRoutes.get("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const { status = "open", mine, event } = c.req.query();
  const where: string[] = ["(t.event_id IS NULL OR COALESCE(e.is_archived, 0) = 0)"];
  const binds: unknown[] = [];

  if (status && status !== "all") {
    where.push("t.status = ?");
    binds.push(status);
    where.push("(t.event_id IS NULL OR e.status NOT IN ('cancelled','regret'))");
  }
  if (event) {
    where.push("t.event_id = ?");
    binds.push(event);
  }
  if (mine === "1" || !can(user.permissions, "task.view.all")) {
    where.push("t.assignee_id = ?");
    binds.push(user.id);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT t.*, e.title AS event_title, e.status AS event_status,
            e.event_start_date AS event_start_date, e.event_end_date AS event_end_date,
            e.event_owner AS event_owner,
            e.overall_completion AS event_overall_completion,
            e.requirements AS event_requirements,
            o.name AS organisation_name,
            ci.module AS source_module, ci.field_key AS source_field_key, ci.label AS source_label,
            (SELECT GROUP_CONCAT(vb.venue, ', ') FROM venue_bookings vb WHERE vb.event_id = e.id) AS event_venues,
            u.name AS assignee_name
     FROM tasks t
     LEFT JOIN events e ON e.id = t.event_id
     LEFT JOIN organisations o ON o.id = e.organisation_id
     LEFT JOIN checklist_items ci ON ci.id = t.source_checklist_item_id
     LEFT JOIN users u ON u.id = t.assignee_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY COALESCE(t.due_date, '9999-12-31'), t.priority = 'high' DESC, t.created_at DESC
     LIMIT 300`
  ).bind(...binds).all();

  return c.json({
    tasks: results.map((task) => {
      const row = task as Record<string, unknown>;
      const readiness = calculateEventFormReadiness(row.event_requirements);
      const { event_requirements: _requirements, ...publicTask } = row;
      void _requirements;
      return { ...publicTask, event_form_readiness: readiness.percentage };
    }),
  });
});

taskRoutes.post("/", requirePermission("task.create"), async (c) => {
  const parsed = TaskInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const user = c.get("user")!;
  const d = parsed.data;
  const now = new Date().toISOString();
  const id = makeId("task");

  await c.env.DB.prepare(
    `INSERT INTO tasks
     (id, title, description, event_id, venue_booking_id, task_type, assignee_id, due_date,
      due_time, priority, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, 'open', ?, ?, ?)`
  ).bind(
    id,
    d.title,
    d.description ?? null,
    d.event_id ?? null,
    d.venue_booking_id ?? null,
    d.assignee_id ?? null,
    d.due_date ?? null,
    d.due_time ?? null,
    d.priority,
    user.id,
    now,
    now
  ).run();

  if (d.event_id) {
    await eventActivity(c.env.DB, d.event_id, "task_created", user.id, { taskId: id, title: d.title });
  }
  await audit({ db: c.env.DB, actor: actorFrom(user), action: "task.created", targetType: "task", targetId: id });
  return c.json({ id }, 201);
});

const TaskPatchInput = z.object({
  status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(),
  assignee_id: z.string().nullish(),
  completion_note: z.string().nullish(),
});

taskRoutes.patch("/:id", requireUser, async (c) => {
  const user = c.get("user")!;
  const task = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(c.req.param("id")).first<{
    id: string;
    event_id: string | null;
    assignee_id: string | null;
    status: string;
  }>();
  if (!task) return c.json({ error: "Task not found" }, 404);

  const parsed = TaskPatchInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid input", detail: parsed.error.flatten() }, 400);
  const d = parsed.data;

  if (d.assignee_id !== undefined && !can(user.permissions, "task.assign")) {
    return c.json({ error: "Insufficient permissions", permission: "task.assign" }, 403);
  }
  if (d.status && !can(user.permissions, "task.complete") && task.assignee_id !== user.id) {
    return c.json({ error: "Insufficient permissions", permission: "task.complete" }, 403);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE tasks
     SET status = COALESCE(?, status),
         assignee_id = COALESCE(?, assignee_id),
         completion_note = COALESCE(?, completion_note),
         completed_at = CASE WHEN ? = 'completed' THEN ? WHEN ? IN ('open','in_progress') THEN NULL ELSE completed_at END,
         completed_by = CASE WHEN ? = 'completed' THEN ? WHEN ? IN ('open','in_progress') THEN NULL ELSE completed_by END,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    d.status ?? null,
    d.assignee_id ?? null,
    d.completion_note ?? null,
    d.status ?? null,
    now,
    d.status ?? null,
    d.status ?? null,
    user.id,
    d.status ?? null,
    now,
    task.id
  ).run();

  if (task.event_id && d.status === "completed") {
    await eventActivity(c.env.DB, task.event_id, "task_completed", user.id, { taskId: task.id, note: d.completion_note ?? null });
  }
  await audit({ db: c.env.DB, actor: actorFrom(user), action: "task.updated", targetType: "task", targetId: task.id, detail: d });
  return c.json({ ok: true });
});
