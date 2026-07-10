import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./components/shell/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { RequireAuth } from "./components/auth/RequireAuth";
import { DashboardPage } from "./pages/DashboardPage";
import { CalendarPage } from "./pages/CalendarPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { EventEditPage } from "./pages/EventEditPage";
import { OrganisationsPage } from "./pages/OrganisationsPage";
import { TasksPage } from "./pages/TasksPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UserManagementPage } from "./pages/UserManagementPage";
import { ProfilePage } from "./pages/ProfilePage";

export default function App() {
  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        {/* Events tab dropped — Calendar is the hub for activity and lifecycle views. */}
        <Route path="/events" element={<Navigate to="/calendar" replace />} />
        <Route path="/events/new" element={<EventEditPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/events/:id/edit" element={<EventEditPage />} />
        <Route path="/organisations" element={<OrganisationsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin/users" element={<UserManagementPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </ErrorBoundary>
  );
}
