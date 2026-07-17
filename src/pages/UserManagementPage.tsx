import { Navigate } from "react-router-dom";

/**
 * User management lives in Settings → Team accounts. This route redirects
 * there so the sidebar entry still resolves. Legacy `#event-owners` hashes
 * are also accepted by the Settings panel.
 */
export function UserManagementPage() {
  return <Navigate to="/settings#team-accounts" replace />;
}
