/**
 * Settings API routes (admin-only). Manages app-level configuration stored in
 * app_settings, including the Resend API key with a configured-check.
 *
 *   GET  /settings              — return non-secret settings + configured flags
 *   PUT  /settings/resend       — set the Resend API key (stored, never returned in full)
 *   POST /settings/resend/test  — send a test email to verify configuration
 *   DELETE /settings/resend     — clear the Resend API key
 *   PUT  /settings/brief        — morning/evening times, email on/off, report recipients
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
import {
  DEFAULT_BRIEF_SETTINGS,
  SETTING_BRIEF_SETTINGS,
  getBriefSettings,
  mergeBriefSettings,
  validateBriefSettings,
  type BriefSettings,
} from "./brief";
import { rescheduleAllAutomaticTasks } from "./operations";

export const settingsRoutes = new Hono<AuthEnv>();

const SETTING_RESEND_KEY = "resend_api_key";
const SETTING_MAIL_FROM = "mail_from";

/** Resolve the effective Resend API key: runtime setting > env secret. */
export async function getResendApiKey(db: D1Database, env: { RESEND_API_KEY?: string }): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING_RESEND_KEY).first<{ value: string | null }>();
  if (row?.value) return row.value;
  return env.RESEND_API_KEY ?? null;
}

/** Resolve the effective "from" address. */
export async function getMailFrom(db: D1Database, env: { MAIL_FROM?: string }): Promise<string> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING_MAIL_FROM).first<{ value: string | null }>();
  return row?.value ?? env.MAIL_FROM ?? "NCPA Venue Hire <noreply@ncpa-hire.pages.dev>";
}

// GET / — non-secret view + configured flags.
settingsRoutes.get("/", requirePermission("settings.manage"), async (c) => {
  const db = c.env.DB;
  const apiKey = await getResendApiKey(db, c.env);
  const mailFrom = await getMailFrom(db, c.env);
  const checklistIntervals = await getChecklistIntervals(db);
  const brief = await getBriefSettings(db);
  return c.json({
    resend: {
      configured: Boolean(apiKey),
      // Show only the last 4 chars so the admin can confirm which key is set.
      keyHint: apiKey ? `••••${apiKey.slice(-4)}` : null,
      source: (await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING_RESEND_KEY).first()) ? "settings" : (c.env.RESEND_API_KEY ? "env" : "none"),
    },
    mailFrom,
    brief,
    briefDefaults: DEFAULT_BRIEF_SETTINGS,
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
  const db = c.env.DB;
  const apiKey = await getResendApiKey(db, c.env);
  if (!apiKey) return c.json({ error: "Resend not configured" }, 400);
  const mailFrom = await getMailFrom(db, c.env);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: mailFrom,
        to: parsed.data.to,
        subject: "NCPA Venue for Hire — test email",
        text: "This is a test email confirming that Resend is correctly configured.",
      }),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")) as string;
      return c.json({ error: `Resend rejected the test: ${res.status}`, detail: body.slice(0, 200) }, 502);
    }
    const data = (await res.json()) as { id?: string };
    return c.json({ ok: true, messageId: data.id ?? "sent" });
  } catch (err) {
    return c.json({ error: "Failed to reach Resend", detail: (err as Error).message }, 502);
  }
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

const BriefSettingsSchema = z.object({
  morning_time: z.string().regex(/^\d{2}:\d{2}$/),
  evening_time: z.string().regex(/^\d{2}:\d{2}$/),
  email_enabled: z.boolean(),
  email_recipients: z.array(z.string()),
  stale_enquiry_days: z.number().int().min(1).max(90).optional(),
  readiness_window_days: z.number().int().min(1).max(90).optional(),
  readiness_threshold: z.number().min(0).max(1).optional(),
  conflict_window_days: z.number().int().min(1).max(365).optional(),
  overdue_list_cap: z.number().int().min(1).max(100).optional(),
});

settingsRoutes.put("/brief", requirePermission("settings.manage"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = BriefSettingsSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid brief settings", detail: parsed.error.flatten() }, 400);

  const current = await getBriefSettings(c.env.DB);
  const next = mergeBriefSettings({
    ...current,
    ...parsed.data,
    email_recipients: parsed.data.email_recipients,
  } as Partial<BriefSettings>);
  const invalid = validateBriefSettings(next);
  if (invalid) return c.json({ error: invalid }, 400);

  const db = c.env.DB;
  const user = c.get("user")!;
  await db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)"
  ).bind(SETTING_BRIEF_SETTINGS, JSON.stringify(next), new Date().toISOString(), user.id).run();
  await audit({
    db,
    actor: actorFrom(user),
    action: "settings.brief_updated",
    detail: {
      morning_time: next.morning_time,
      evening_time: next.evening_time,
      email_enabled: next.email_enabled,
      email_recipients: next.email_recipients,
    },
  });
  return c.json({ ok: true, brief: next });
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
  await rescheduleAllAutomaticTasks(db);
  await audit({
    db,
    actor: actorFrom(user),
    action: "settings.checklist_intervals_updated",
    detail: { intervals },
  });
  return c.json({ ok: true, checklistIntervals: intervals });
});
