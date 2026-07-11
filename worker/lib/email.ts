import type { Env } from "../env";
import { getMailFrom, getResendApiKey, getEmailFallback } from "./secrets";

/** Resend's built-in testing sender — works without a verified domain. */
export const RESEND_TESTING_FROM = "NCPA Venue Hire <onboarding@resend.dev>";

type EmailEnv = Pick<Env, "DB" | "MAIL_FROM" | "RESEND_API_KEY">;

export type SendEmailResult =
  | { ok: true; messageId?: string; viaFallback?: boolean }
  | { ok: false; error: string; testingMode?: boolean };

/**
 * Send a single transactional email immediately (not queued via the
 * notifications table). Used for time-sensitive flows like password reset
 * links, where waiting for the next cron dispatch would be unacceptable.
 *
 * If the configured From address is rejected (unverified domain), retries
 * once with Resend's onboarding@resend.dev testing sender.
 */
export async function sendTransactionalEmail(
  env: EmailEnv,
  message: { to: string; subject: string; text: string }
): Promise<SendEmailResult> {
  const db = env.DB;
  const apiKey = await getResendApiKey(db, env);
  if (!apiKey) return { ok: false, error: "Resend is not configured." };
  const configuredFrom = await getMailFrom(db, env);

  const first = await postResend(apiKey, configuredFrom, message);
  if (first.ok) return first;

  // Unverified custom domain → retry with Resend's testing sender.
  if (isUnverifiedDomainError(first.error) && !isResendTestingFrom(configuredFrom)) {
    const retry = await postResend(apiKey, RESEND_TESTING_FROM, message);
    if (retry.ok) return retry;
    return annotateTestingMode(retry);
  }

  return annotateTestingMode(first);
}

/**
 * Password-reset delivery: try the user, then (if Resend is still in
 * testing mode / recipient blocked) deliver the same link to the configured
 * admin fallback inbox so the reset is not silently lost.
 */
export async function sendPasswordResetEmail(
  env: EmailEnv,
  message: { to: string; subject: string; text: string; userName: string }
): Promise<SendEmailResult> {
  const primary = await sendTransactionalEmail(env, {
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
  if (primary.ok) return primary;

  const fallback = await getEmailFallback(env.DB);
  if (!fallback || fallback.toLowerCase() === message.to.toLowerCase()) {
    return primary;
  }

  const relay = await sendTransactionalEmail(env, {
    to: fallback,
    subject: `[Relay] ${message.subject} (for ${message.to})`,
    text:
      `A password reset was requested for ${message.userName} <${message.to}>, ` +
      `but Resend could not deliver to that address yet (usually because the sending ` +
      `domain is not verified).\n\n` +
      `Forward this link to them, or use Settings → Admin password reset.\n\n` +
      `${message.text}\n\n` +
      `Original delivery error: ${primary.error}`,
  });

  if (relay.ok) return { ok: true, messageId: relay.messageId, viaFallback: true };
  return primary;
}

/**
 * Send an HTML email immediately (used by the twice-daily brief digests,
 * which need rich formatting the plain-text notification queue can't carry).
 */
export async function sendHtmlEmail(
  env: EmailEnv,
  message: { to: string; subject: string; html: string }
): Promise<SendEmailResult> {
  const db = env.DB;
  const apiKey = await getResendApiKey(db, env);
  if (!apiKey) return { ok: false, error: "Resend is not configured." };
  const configuredFrom = await getMailFrom(db, env);

  const first = await postResendHtml(apiKey, configuredFrom, message);
  if (first.ok) return first;

  if (isUnverifiedDomainError(first.error) && !isResendTestingFrom(configuredFrom)) {
    const retry = await postResendHtml(apiKey, RESEND_TESTING_FROM, message);
    if (retry.ok) return retry;
    return annotateTestingMode(retry);
  }

  return annotateTestingMode(first);
}

type PendingEmail = {
  id: string;
  title: string;
  body: string | null;
  recipient_id: string | null;
  recipient_role: string | null;
  email: string | null;
};

export async function dispatchPendingEmailNotifications(env: EmailEnv): Promise<number> {
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

  let sent = 0;
  for (const notification of results) {
    if (!notification.email) {
      await markOne(db, notification.id, "skipped", null, "No recipient email address.");
      continue;
    }
    const result = await sendTransactionalEmail(env, {
      to: notification.email,
      subject: notification.title,
      text: notification.body ?? notification.title,
    });
    if (!result.ok) {
      await markOne(db, notification.id, "failed", null, result.error.slice(0, 250));
      continue;
    }
    await markOne(db, notification.id, "sent", result.messageId ?? "sent", null);
    sent++;
  }
  return sent;
}

async function postResend(
  apiKey: string,
  from: string,
  message: { to: string; subject: string; text: string }
): Promise<SendEmailResult> {
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
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, messageId: data.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function postResendHtml(
  apiKey: string,
  from: string,
  message: { to: string; subject: string; html: string }
): Promise<SendEmailResult> {
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
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, messageId: data.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function isResendTestingFrom(from: string): boolean {
  return /@resend\.dev>?$/i.test(from.trim());
}

export function isUnverifiedDomainError(error: string): boolean {
  return /domain is not verified|verify a domain|only send testing emails/i.test(error);
}

function annotateTestingMode(result: SendEmailResult): SendEmailResult {
  if (result.ok) return result;
  if (isUnverifiedDomainError(result.error)) {
    return { ...result, testingMode: true };
  }
  return result;
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
