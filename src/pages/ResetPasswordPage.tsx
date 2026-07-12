import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MarbleBackdrop } from "../components/MarbleBackdrop";
import { apiPost } from "../lib/api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      await apiPost("/auth/password/reset", { token, newPassword });
      navigate("/login", { replace: true, state: { message: "Password reset. Please sign in." } });
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <MarbleBackdrop />
        <div className="w-full max-w-sm text-center">
          <p className="mb-4 text-sm text-ink-secondary etched">This reset link is missing its token.</p>
          <Link to="/forgot-password" className="text-xs text-sage-text hover:underline">Request a new link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <MarbleBackdrop />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-ink-primary etched-deep">Choose a new password</h1>
        </div>
        <form onSubmit={onSubmit} className="carved-card rounded-2xl bg-marble-highlight/60 p-6 backdrop-blur-sm">
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-sage etched">New password</span>
            <input
              type="password"
              required
              minLength={10}
              autoFocus
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
              autoComplete="new-password"
            />
          </label>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-sage etched">Confirm new password</span>
            <input
              type="password"
              required
              minLength={10}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
              autoComplete="new-password"
            />
          </label>
          {error && (
            <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="carved-btn-terracotta w-full rounded-full bg-terracotta-btn py-2.5 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
          >
            {loading ? "Resetting…" : "Reset password"}
          </button>
        </form>
      </div>
    </div>
  );
}
