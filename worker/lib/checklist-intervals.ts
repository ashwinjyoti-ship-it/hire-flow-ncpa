/**
 * Configurable checklist task intervals (days after the trigger date).
 * Defaults match the historical hardcoded values in checklist-definitions seed
 * and createFileToAccountsReminders.
 */
export const SETTING_CHECKLIST_INTERVALS = "checklist_intervals";

export const CHECKLIST_INTERVAL_KEYS = [
  "approval_followup",
  "instalment",
  "confirmation_letter",
  "onstage",
  "technical_meeting",
  "feedback",
  "accounts_file",
  "send_file_to_accounts",
  "tds_send_to_accounts",
] as const;

export type ChecklistIntervalKey = (typeof CHECKLIST_INTERVAL_KEYS)[number];

export type ChecklistIntervals = Record<ChecklistIntervalKey, number>;

export const DEFAULT_CHECKLIST_INTERVALS: ChecklistIntervals = {
  approval_followup: 7,
  instalment: 0,
  confirmation_letter: 3,
  onstage: 3,
  technical_meeting: 0,
  feedback: 5,
  accounts_file: 3,
  send_file_to_accounts: 1,
  tds_send_to_accounts: 0,
};

/** UI metadata for Settings → Check List Intervals. */
export const CHECKLIST_INTERVAL_META: Array<{
  key: ChecklistIntervalKey;
  label: string;
  description: string;
}> = [
  {
    key: "approval_followup",
    label: "Approval follow-up",
    description: "Days after Approval Sent On before the follow-up task is due.",
  },
  {
    key: "instalment",
    label: "Installment follow-up",
    description: "Days after each installment expected date (0 = due on that date).",
  },
  {
    key: "confirmation_letter",
    label: "Confirmation letter follow-up",
    description: "Days after Confirmation Letter is couriered.",
  },
  {
    key: "onstage",
    label: "OnStage follow-up",
    description: "Days after OnStage is asked of the client.",
  },
  {
    key: "technical_meeting",
    label: "Technical meeting",
    description: "Days after the technical meeting date (0 = due on that date).",
  },
  {
    key: "feedback",
    label: "Feedback follow-up",
    description: "Days after the feedback form is sent.",
  },
  {
    key: "accounts_file",
    label: "Accounts file follow-up",
    description: "Days after File Sent to Accounts before follow-up is due.",
  },
  {
    key: "send_file_to_accounts",
    label: "Send file to accounts",
    description: "Days after the final show date to create the Send file to accounts task.",
  },
  {
    key: "tds_send_to_accounts",
    label: "Send TDS certificate to Accounts",
    description: "Days after TDS is received from the client before the send-to-Accounts task is due (0 = due on that date).",
  },
];

export function mergeChecklistIntervals(raw: unknown): ChecklistIntervals {
  const out: ChecklistIntervals = { ...DEFAULT_CHECKLIST_INTERVALS };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of CHECKLIST_INTERVAL_KEYS) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      out[key] = Math.floor(value);
    } else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      const n = Math.floor(Number(value));
      if (n >= 0) out[key] = n;
    }
  }
  return out;
}

export async function getChecklistIntervals(db: D1Database): Promise<ChecklistIntervals> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(SETTING_CHECKLIST_INTERVALS)
    .first<{ value: string | null }>();
  if (!row?.value) return { ...DEFAULT_CHECKLIST_INTERVALS };
  try {
    return mergeChecklistIntervals(JSON.parse(row.value) as unknown);
  } catch {
    return { ...DEFAULT_CHECKLIST_INTERVALS };
  }
}

/**
 * Resolve due_after_days for a triggers_task rule, preferring app settings
 * over the value baked into checklist_definitions.
 */
export function dueAfterDaysForRule(
  intervals: ChecklistIntervals,
  rule: string,
  fallback: number
): number {
  if ((CHECKLIST_INTERVAL_KEYS as readonly string[]).includes(rule)) {
    return intervals[rule as ChecklistIntervalKey];
  }
  return fallback;
}

/**
 * Keep checklist_definitions.triggers_task JSON in sync when intervals change,
 * so seed-shaped data and runtime settings stay aligned.
 */
export async function syncChecklistDefinitionIntervals(
  db: D1Database,
  intervals: ChecklistIntervals
): Promise<void> {
  const { results } = await db
    .prepare("SELECT id, triggers_task FROM checklist_definitions WHERE triggers_task IS NOT NULL")
    .all<{ id: string; triggers_task: string }>();

  for (const row of results ?? []) {
    let parsed: { rule?: string; due_after_days?: number; [k: string]: unknown };
    try {
      parsed = JSON.parse(row.triggers_task) as typeof parsed;
    } catch {
      continue;
    }
    if (!parsed.rule || !(CHECKLIST_INTERVAL_KEYS as readonly string[]).includes(parsed.rule)) {
      continue;
    }
    const key = parsed.rule as ChecklistIntervalKey;
    if (parsed.due_after_days === intervals[key]) continue;
    parsed.due_after_days = intervals[key];
    await db
      .prepare("UPDATE checklist_definitions SET triggers_task = ? WHERE id = ?")
      .bind(JSON.stringify(parsed), row.id)
      .run();
  }
}
