/**
 * Audit logging. Records system-level events (auth, role changes, overrides,
 * date corrections, conflict overrides, etc.). Never logs secrets.
 */
import { makeId } from "./id";

export interface AuditActor {
  id: string | null;
  email: string | null;
}

export interface AuditInput {
  db: D1Database;
  actor?: AuditActor;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
  ipHint?: string;
}

/** Write an audit log entry. Best-effort — never throws to break the caller. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await input.db
      .prepare(
        `INSERT INTO audit_logs (id, actor_id, actor_email, action, target_type, target_id, detail, ip_hint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        makeId("aud"),
        input.actor?.id ?? null,
        input.actor?.email ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.detail ? JSON.stringify(input.detail) : null,
        input.ipHint ?? null,
        new Date().toISOString()
      )
      .run();
  } catch {
    // Swallow — audit must never break the primary operation.
  }
}

/** Write a per-event activity entry. */
export async function eventActivity(
  db: D1Database,
  eventId: string,
  activityType: string,
  actorId: string | null,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO event_activity (id, event_id, activity_type, detail, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        makeId("act"),
        eventId,
        activityType,
        detail ? JSON.stringify(detail) : null,
        actorId,
        new Date().toISOString()
      )
      .run();
  } catch {
    // Swallow.
  }
}
