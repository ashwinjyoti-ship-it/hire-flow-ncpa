import { useState } from "react";
import { Link } from "react-router-dom";
import { MarbleBackdrop } from "../components/MarbleBackdrop";
import { apiPost } from "../lib/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost("/auth/password/forgot", { email });
      setSent(true);
    } catch {
      // The endpoint always returns ok; a network error is the only failure mode.
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <MarbleBackdrop />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-ink-primary etched-deep">Reset your password</h1>
          <p className="mt-1 text-sm text-ink-muted etched">We'll email you a link if the address is registered.</p>
        </div>

        <div className="carved-card rounded-2xl bg-marble-highlight/60 p-6 backdrop-blur-sm">
          {sent ? (
            <div>
              <p role="status" className="mb-4 text-sm text-ink-secondary etched">
                If that email is registered, a reset link has been sent. It expires in 30 minutes.
              </p>
              <Link to="/login" className="text-xs text-sage-text hover:underline">
                ← Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <label className="mb-4 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-sage etched">Email</span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                  autoComplete="email"
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
                {loading ? "Sending…" : "Send reset link"}
              </button>
              <Link to="/login" className="mt-3 block text-center text-xs text-ink-muted hover:text-ink-secondary">
                ← Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
