import { Navigate } from "react-router-dom";

/**
 * User management lives in Settings → Event Owners, where account creation is
 * unified with the event-owner dropdown (each owner is a real login). This
 * route redirects there so the sidebar entry still resolves.
 */
export function UserManagementPage() {
  return <Navigate to="/settings#event-owners" replace />;
}
