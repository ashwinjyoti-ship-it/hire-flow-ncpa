/**
 * Per-user permissions. Every account carries an explicit list of permission
 * keys (users.permissions, JSON array) assigned from Settings → Team Accounts
 * by whoever holds `user.manage` — there are no fixed roles. Permissions are
 * enforced in BOTH the Worker API and the frontend (the frontend hides or
 * disables actions; the API rejects them).
 *
 * The legacy role → permission mapping is kept ONLY so that user rows created
 * before migration 0016 (permissions IS NULL) keep working until backfilled.
 */

/** Granular permission keys. */
export type Permission =
  | "event.create"
  | "event.view"
  | "event.view.all"
  | "event.edit"
  | "event.edit.all"
  | "event.status.change"
  | "event.cancel"
  | "event.archive"
  | "checklist.update"
  | "task.create"
  | "task.complete"
  | "task.assign"
  | "task.view.all"
  | "document.upload"
  | "document.delete"
  | "conflict.override"
  | "date.correct"
  | "report.generate"
  | "report.view"
  | "analytics.view"
  | "announcement.manage"
  | "user.manage"
  | "settings.manage"
  | "notification.rules.manage"
  | "audit.view";

export const ALL_PERMISSIONS: Permission[] = [
  "event.create", "event.view", "event.view.all", "event.edit", "event.edit.all",
  "event.status.change", "event.cancel", "event.archive",
  "checklist.update", "task.create", "task.complete", "task.assign", "task.view.all",
  "document.upload", "document.delete", "conflict.override", "date.correct",
  "report.generate", "report.view", "analytics.view", "announcement.manage",
  "user.manage", "settings.manage", "notification.rules.manage", "audit.view",
];

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/** Does this permission list grant the permission? */
export function can(permissions: readonly string[] | null | undefined, permission: Permission): boolean {
  return permissions?.includes(permission) ?? false;
}

/** Parse + validate a stored permissions value (JSON array or already-parsed). */
export function normalisePermissions(raw: unknown): Permission[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((p): p is Permission => typeof p === "string" && PERMISSION_SET.has(p)))];
}

/**
 * Legacy role → permissions mapping. Used only to interpret user rows from
 * before migration 0016 and by the seed scripts; nothing in the application
 * workflows assigns or checks roles anymore.
 */
export const LEGACY_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  venue_manager: [
    "event.create", "event.view", "event.view.all", "event.edit", "event.edit.all",
    "event.status.change", "event.cancel", "event.archive",
    "checklist.update", "task.create", "task.complete", "task.assign", "task.view.all",
    "document.upload", "document.delete", "conflict.override", "date.correct",
    "report.generate", "report.view", "analytics.view",
  ],
  coordinator: [
    "event.create", "event.view", "event.edit",
    "checklist.update", "task.create", "task.complete",
    "document.upload", "report.view",
  ],
  viewer: ["event.view", "report.view"],
};

/** Resolve a user row's effective permissions (legacy-role fallback for pre-0016 rows). */
export function permissionsFromRow(permissionsJson: string | null | undefined, legacyRole?: string | null): Permission[] {
  if (permissionsJson) {
    const parsed = normalisePermissions(permissionsJson);
    if (parsed.length) return parsed;
  }
  return legacyRole ? (LEGACY_ROLE_PERMISSIONS[legacyRole] ?? []) : [];
}

// ------------------------------------------------------------------ UI metadata

/** Grouped labels for the Settings → Team Accounts permission editor. */
export const PERMISSION_GROUPS: Array<{
  group: string;
  items: Array<{ key: Permission; label: string }>;
}> = [
  {
    group: "Events",
    items: [
      { key: "event.create", label: "Create events" },
      { key: "event.view", label: "View events" },
      { key: "event.view.all", label: "View all events" },
      { key: "event.edit", label: "Edit events" },
      { key: "event.edit.all", label: "Edit all events" },
      { key: "event.status.change", label: "Change lifecycle status" },
      { key: "event.cancel", label: "Cancel / decline events" },
      { key: "event.archive", label: "Delete (archive) events" },
      { key: "conflict.override", label: "Override venue conflicts" },
      { key: "date.correct", label: "Correct recorded dates" },
    ],
  },
  {
    group: "Checklists & tasks",
    items: [
      { key: "checklist.update", label: "Update checklists" },
      { key: "task.create", label: "Create tasks" },
      { key: "task.complete", label: "Complete tasks" },
      { key: "task.assign", label: "Assign tasks" },
      { key: "task.view.all", label: "View everyone's tasks" },
    ],
  },
  {
    group: "Documents",
    items: [
      { key: "document.upload", label: "Upload documents" },
      { key: "document.delete", label: "Archive documents" },
    ],
  },
  {
    group: "Reports & analytics",
    items: [
      { key: "report.view", label: "View reports" },
      { key: "report.generate", label: "Generate & delete reports" },
      { key: "analytics.view", label: "View analytics" },
    ],
  },
  {
    group: "Administration",
    items: [
      { key: "announcement.manage", label: "Post team announcements" },
      { key: "user.manage", label: "Manage team accounts" },
      { key: "settings.manage", label: "Manage settings" },
      { key: "notification.rules.manage", label: "Manage notification rules" },
      { key: "audit.view", label: "View audit log" },
    ],
  },
];

/** Convenience presets for the editor — just tick-box shortcuts, not stored roles. */
export const PERMISSION_PRESETS: Array<{ label: string; permissions: Permission[] }> = [
  { label: "Full access", permissions: [...ALL_PERMISSIONS] },
  { label: "Event manager", permissions: [...LEGACY_ROLE_PERMISSIONS.venue_manager!] },
  { label: "Coordinator", permissions: [...LEGACY_ROLE_PERMISSIONS.coordinator!] },
  { label: "Read-only", permissions: [...LEGACY_ROLE_PERMISSIONS.viewer!] },
];

/** Short human description of an account's access, for display next to names. */
export function describeAccess(permissions: readonly string[] | null | undefined): string {
  const set = new Set(permissions ?? []);
  for (const preset of PERMISSION_PRESETS) {
    if (preset.permissions.length === set.size && preset.permissions.every((p) => set.has(p))) {
      return preset.label;
    }
  }
  if (set.size === 0) return "No access";
  return `Custom (${set.size})`;
}
