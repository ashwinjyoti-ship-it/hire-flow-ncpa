/** Role label mirror of worker/lib/rbac.ts for client display. */
import type { UserRole } from "../../worker/env";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  venue_manager: "Venue Manager",
  coordinator: "Coordinator",
  viewer: "Viewer",
};
