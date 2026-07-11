/**
 * Settings API routes (admin-only). Manages app-level configuration stored in
 * app_settings, including the Resend API key with a configured-check.
 *
 *   GET  /settings              — return non-secret settings + configured flags
 *   PUT  /settings/resend       — set the Resend API key (stored, never returned in full)
 *   POST /settings/resend/test  — send a test email to verify configuration
 *   DELETE /settings/resend     — clear the Resend API key
 *   PUT  /settings/checklist-intervals — update checklist task due-after-days intervals
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../middleware/auth";
import { requirePermission } from "../middleware/auth";
import { actorFrom } from "../middleware/auth";
import { audit } from "../lib/audit";
import { makeId } from "../lib/id";
import {
  CHECKLIST_INTERVAL_KEYS,
  CHECKLIST_INTERVAL_META,
  DEFAULT_CHECKLIST_INTERVALS,
  SETTING_CHECKLIST_INTERVALS,
  getChecklistIntervals,
  mergeChecklistIntervals,
  syncChecklistDefinitionIntervals,
  type ChecklistIntervals,
} from "./checklist-intervals";

export const settingsRoutes = new Hono<AuthEnv>();

const SETTING_RESEND_KEY = "resend_api_key";
const SETTING_MAIL_FROM = "mail_from";
const SETTING_EMAIL_FALLBACK = "email_fallback";

/** Resolve the effective Resend API key: runtime setting > env secret. */
export async function getResendApiKey(db: D1Database, env: { RESEND_API_KEY?: string }): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING_RESEND_KEY).first<{ value: string | null }>();
  if (row?.value) return row.value;
  return env.RESEND_API_KEY ?? null;
}

/** Resolve the effective "from" address. */
export async function getMailFrom(db: D1Database, env: { MAIL_FROM?: string }): Promise<string> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING_MAIL_FROM).first<{ value: string | null }>();
  return row?.value ?? env.MAIL_FROM ?? "NCPA Venue Hire <onboarding@resend.dev>";
}

/** Admin inbox used when Resend cannot yet deliver to arbitrary recipients. */
export async function getEmailFallback(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING_EMAIL_FALLBACK).first<{ value: string | null }>();
  const value = row?.value?.trim();
  return value || null;
}

type ResendDomainSummary = { id: string; name: string; status: string };

async function listResendDomains(apiKey: string): Promise<ResendDomainSummary[]> {
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as { data?: ResendDomainSummary[] };
    return data.data ?? [];
  } catch {
    return [];
  }
}

// GET / — non-secret view + configured flags.
settingsRoutes.get("/", requirePermission("settings.manage"), async (c) => {
  const db = c.env.DB;
  const apiKey = await getResendApiKey(db, c.env);
  const mailFrom = await getMailFrom(db, c.env);
  const emailFallback = await getEmailFallback(db);
  const checklistIntervals = await getChecklistIntervals(db);
  const domains = apiKey ? await listResendDomains(apiKey) : [];
  const verifiedDomain = domains.find((d) => d.status === "verified" || d.status === "live");
  const lastFailure = await db.prepare(
    `SELECT detail, created_at FROM audit_logs
     WHERE action IN ('auth.password_reset_email_failed', 'auth.password_reset_relayed')
     ORDER BY created_at DESC LIMIT 1`
  ).first<{ detail: string | null; created_at: string }>();

  return c.json({
    resend: {
      configured: Boolean(apiKey),
      // Show only the last 4 chars so the admin can confirm which key is set.
      keyHint: apiKey ? `••••${apiKey.slice(-4)}` : null,
      source: (await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING_RESEND_KEY).first()) ? "settings" : (c.env.RESEND_API_KEY ? "env" : "none"),
      testingMode: Boolean(apiKey) && !verifiedDomain,
      domains: domains.map((d) => ({ name: d.name, status: d.status })),
    },
    mailFrom,
    emailFallback,
    emailHealth: lastFailure
      ? { lastErrorAt: lastFailure.created_at, lastError: lastFailure.detail }
      : null,
    checklistIntervals,
    checklistIntervalMeta: CHECKLIST_INTERVAL_META,
    checklistIntervalDefaults: DEFAULT_CHECKLIST_INTERVALS,
  });
});

const ResendSchema = z.object({ apiKey: z.string().min(10) });
settingsRoutes.put("/resend", requirePermission("settings.manage"), async (c) => {
  const parsed = ResendSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid API key" }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  await db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)"
  ).bind(SETTING_RESEND_KEY, parsed.data.apiKey, new Date().toISOString(), user.id).run();
  await audit({ db, actor: actorFrom(user), action: "settings.resend_updated", detail: { keyHint: `••••${parsed.data.apiKey.slice(-4)}` } });
  return c.json({ ok: true, configured: true, keyHint: `••••${parsed.data.apiKey.slice(-4)}` });
});

settingsRoutes.delete("/resend", requirePermission("settings.manage"), async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  await db.prepare("DELETE FROM app_settings WHERE key = ?").bind(SETTING_RESEND_KEY).run();
  await audit({ db, actor: actorFrom(user), action: "settings.resend_cleared" });
  return c.json({ ok: true });
});

const TestSchema = z.object({ to: z.string().email() });
settingsRoutes.post("/resend/test", requirePermission("settings.manage"), async (c) => {
  const parsed = TestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Valid recipient email required" }, 400);
  const apiKey = await getResendApiKey(c.env.DB, c.env);
  if (!apiKey) return c.json({ error: "Resend not configured" }, 400);

  const { sendTransactionalEmail } = await import("./email");
  const result = await sendTransactionalEmail(c.env, {
    to: parsed.data.to,
    subject: "NCPA Venue for Hire — test email",
    text: "This is a test email confirming that Resend is correctly configured.",
  });
  if (!result.ok) {
    return c.json({
      error: result.testingMode
        ? "Resend is in testing mode. Verify a domain at resend.com/domains, or send the test to your Resend account email."
        : `Resend rejected the test`,
      detail: result.error.slice(0, 200),
    }, 502);
  }
  return c.json({ ok: true, messageId: result.messageId ?? "sent" });
});

const MailFromSchema = z.object({ mailFrom: z.string().min(3) });
settingsRoutes.put("/mail-from", requirePermission("settings.manage"), async (c) => {
  const parsed = MailFromSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid from address" }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  await db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)"
  ).bind(SETTING_MAIL_FROM, parsed.data.mailFrom, new Date().toISOString(), user.id).run();
  void makeId;
  await audit({ db, actor: actorFrom(user), action: "settings.mail_from_updated", detail: { mailFrom: parsed.data.mailFrom } });
  return c.json({ ok: true, mailFrom: parsed.data.mailFrom });
});

const FallbackSchema = z.object({ email: z.union([z.string().email(), z.literal("")]) });
settingsRoutes.put("/email-fallback", requirePermission("settings.manage"), async (c) => {
  const parsed = FallbackSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Valid email required (or empty to clear)" }, 400);
  const db = c.env.DB;
  const user = c.get("user")!;
  const value = parsed.data.email.trim();
  if (!value) {
    await db.prepare("DELETE FROM app_settings WHERE key = ?").bind(SETTING_EMAIL_FALLBACK).run();
  } else {
    await db.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)"
    ).bind(SETTING_EMAIL_FALLBACK, value.toLowerCase(), new Date().toISOString(), user.id).run();
  }
  await audit({
    db, actor: actorFrom(user), action: "settings.email_fallback_updated",
    detail: { emailFallback: value || null },
  });
  return c.json({ ok: true, emailFallback: value || null });
});

const ChecklistIntervalsSchema = z.object(
  Object.fromEntries(
    CHECKLIST_INTERVAL_KEYS.map((key) => [key, z.number().int().min(0).max(365)])
  ) as Record<(typeof CHECKLIST_INTERVAL_KEYS)[number], z.ZodNumber>
);

settingsRoutes.put("/checklist-intervals", requirePermission("settings.manage"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const merged = mergeChecklistIntervals(body);
  const parsed = ChecklistIntervalsSchema.safeParse(merged);
  if (!parsed.success) return c.json({ error: "Invalid checklist intervals", detail: parsed.error.flatten() }, 400);

  const intervals = parsed.data as ChecklistIntervals;
  const db = c.env.DB;
  const user = c.get("user")!;
  await db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)"
  ).bind(SETTING_CHECKLIST_INTERVALS, JSON.stringify(intervals), new Date().toISOString(), user.id).run();

  await syncChecklistDefinitionIntervals(db, intervals);
  await audit({
    db,
    actor: actorFrom(user),
    action: "settings.checklist_intervals_updated",
    detail: { intervals },
  });
  return c.json({ ok: true, checklistIntervals: intervals });
});
