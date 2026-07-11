/** Client-side permission mirror of worker/lib/rbac.ts. */
import { can as canServer, type Permission } from "../../worker/lib/rbac";

export function can(permissions: readonly string[] | null | undefined, permission: Permission): boolean {
  return canServer(permissions, permission);
}
