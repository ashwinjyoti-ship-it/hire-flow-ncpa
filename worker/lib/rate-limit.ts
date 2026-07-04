/**
 * Authentication rate limiting + lockout. Uses the users.failed_logins and
 * users.locked_until columns. After 5 failed attempts, locks for 15 minutes.
 */
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/** Record a failed login attempt; locks the account if threshold reached. */
export async function recordFailedLogin(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ?`
    )
    .bind(userId)
    .run();
  const row = await db
    .prepare("SELECT failed_logins FROM users WHERE id = ?")
    .bind(userId)
    .first<{ failed_logins: number }>();
  if (row && row.failed_logins >= MAX_FAILED) {
    const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    await db
      .prepare("UPDATE users SET locked_until = ? WHERE id = ?")
      .bind(lockUntil, userId)
      .run();
  }
}

/** Reset failed-login counters on a successful login. */
export async function recordSuccessfulLogin(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`
    )
    .bind(new Date().toISOString(), userId)
    .run();
}

/** Is the account currently locked out? */
export async function isLocked(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT locked_until FROM users WHERE id = ?")
    .bind(userId)
    .first<{ locked_until: string | null }>();
  if (!row || !row.locked_until) return false;
  return new Date(row.locked_until).getTime() > Date.now();
}
