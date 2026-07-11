import type { Env } from "../env";
import { getMailFrom, getResendApiKey } from "./secrets";

/**
 * Send a single transactional email immediately (not queued via the
 * notifications table). Used for time-sensitive flows like password reset
 * links, where waiting for the next cron dispatch would be unacceptable.
 */
export async function sendTransactionalEmail(
  env: Pick<Env, "DB" | "MAIL_FROM" | "RESEND_API_KEY">,
  message: { to: string; subject: string; text: string }
): Promise<{ ok: boolean; error?: string }> {
  const db = env.DB;
  const apiKey = await getResendApiKey(db, env);
  if (!apiKey) return { ok: false, error: "Resend is not configured." };
  const from = await getMailFrom(db, env);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: body.slice(0, 250) || `Resend rejected ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Send an HTML email immediately (used by the twice-daily brief digests,
 * which need rich formatting the plain-text notification queue can't carry).
 */
export async function sendHtmlEmail(
  env: Pick<Env, "DB" | "MAIL_FROM" | "RESEND_API_KEY">,
  message: { to: string; subject: string; html: string }
): Promise<{ ok: boolean; error?: string }> {
  const db = env.DB;
  const apiKey = await getResendApiKey(db, env);
  if (!apiKey) return { ok: false, error: "Resend is not configured." };
  const from = await getMailFrom(db, env);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: message.to, subject: message.subject, html: message.html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: body.slice(0, 250) || `Resend rejected ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

type PendingEmail = {
  id: string;
  title: string;
  body: string | null;
  recipient_id: string | null;
  recipient_role: string | null;
  email: string | null;
};

export async function dispatchPendingEmailNotifications(env: Pick<Env, "DB" | "MAIL_FROM" | "RESEND_API_KEY">): Promise<number> {
  const db = env.DB;
  const apiKey = await getResendApiKey(db, env);
  const { results } = await db.prepare(
    `SELECT n.id, n.title, n.body, n.recipient_id, n.recipient_role, u.email
     FROM notifications n
     LEFT JOIN users u ON u.id = n.recipient_id
     WHERE n.channel = 'email' AND COALESCE(n.email_status, 'pending') = 'pending'
     ORDER BY n.created_at
     LIMIT 25`
  ).all<PendingEmail>();

  if (!results.length) return 0;
  if (!apiKey) {
    await markSkipped(db, results, "Resend is not configured.");
    return 0;
  }

  const from = await getMailFrom(db, env);
  let sent = 0;
  for (const notification of results) {
    if (!notification.email) {
      await markOne(db, notification.id, "skipped", null, "No recipient email address.");
      continue;
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: notification.email,
          subject: notification.title,
          text: notification.body ?? notification.title,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        await markOne(db, notification.id, "failed", null, body.slice(0, 250) || `Resend rejected ${res.status}`);
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      await markOne(db, notification.id, "sent", data.id ?? "sent", null);
      sent++;
    } catch (err) {
      await markOne(db, notification.id, "failed", null, (err as Error).message);
    }
  }
  return sent;
}

async function markSkipped(db: D1Database, rows: PendingEmail[], reason: string): Promise<void> {
  for (const row of rows) {
    await markOne(db, row.id, "skipped", null, reason);
  }
}

async function markOne(db: D1Database, id: string, status: string, messageId: string | null, error: string | null): Promise<void> {
  await db.prepare(
    `UPDATE notifications
     SET email_status = ?, email_message_id = ?, email_error = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END
     WHERE id = ?`
  ).bind(status, messageId, error, status, new Date().toISOString(), id).run();
}
