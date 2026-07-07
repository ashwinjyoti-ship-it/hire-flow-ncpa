/**
 * Role-Based Access Control. Permissions are enforced in BOTH the Worker API
 * and the frontend (the frontend hides/disables actions; the API rejects them).
 *
 * Roles (per the spec):
 *   admin         — full access, override with reason, manage users/settings
 *   venue_manager — view/edit all events, change statuses, manage checklists, override conflicts
 *   coordinator   — create inquiries, update assigned events, complete tasks, upload docs
 *   viewer        — read-only
 */
import type { UserRole } from "../env";

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
  | "user.manage"
  | "settings.manage"
  | "notification.rules.manage"
  | "audit.view";

const GRANTS: Record<UserRole, Permission[]> = {
  admin: [
    "event.create", "event.view", "event.view.all", "event.edit", "event.edit.all",
    "event.status.change", "event.cancel", "event.archive",
    "checklist.update", "task.create", "task.complete", "task.assign", "task.view.all",
    "document.upload", "document.delete", "conflict.override", "date.correct",
    "report.generate", "report.view", "analytics.view",
    "user.manage", "settings.manage", "notification.rules.manage", "audit.view",
  ],
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
  viewer: [
    "event.view", "report.view",
  ],
};

/** Does the role grant the permission? */
export function can(role: UserRole, permission: Permission): boolean {
  return GRANTS[role]?.includes(permission) ?? false;
}

/** Role hierarchy rank (for UI sorting / display). */
export const ROLE_RANK: Record<UserRole, number> = {
  admin: 0,
  venue_manager: 1,
  coordinator: 2,
  viewer: 3,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  venue_manager: "Venue Manager",
  coordinator: "Coordinator",
  viewer: "Viewer",
};
