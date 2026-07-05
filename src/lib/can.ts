/** Client-side permission mirror of worker/lib/rbac.ts. */
import type { UserRole } from "../../worker/env";
import { can as canServer, type Permission } from "../../worker/lib/rbac";

export function can(role: UserRole, permission: Permission): boolean {
  return canServer(role, permission);
}
