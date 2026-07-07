import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MarbleBackdrop } from "../components/MarbleBackdrop";

type Phase = "credentials" | "mfa";

function destinationFor(mustChangePassword?: boolean): string {
  return mustChangePassword ? "/profile?forcePasswordChange=1" : "/dashboard";
}

export function LoginPage() {
  const location = useLocation();
  const stateMessage = (location.state as { message?: string } | null)?.message ?? null;
  const [phase, setPhase] = useState<Phase>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaSessionId, setMfaSessionId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mfaRequired?: boolean;
        sessionId?: string;
        mustChangePassword?: boolean;
      };
      if (!res.ok) {
        setError(data.error ?? "Sign-in failed.");
        setLoading(false);
        return;
      }
      if (data.mfaRequired && data.sessionId) {
        setMfaSessionId(data.sessionId);
        setPhase("mfa");
        setLoading(false);
        return;
      }
      window.location.href = destinationFor(data.mustChangePassword);
    } catch {
      setError("Network error.");
      setLoading(false);
    }
  }

  async function onMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId: mfaSessionId, code, useRecovery }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; mustChangePassword?: boolean };
      if (!res.ok) {
        setError(data.error ?? "Invalid code.");
        setLoading(false);
        return;
      }
      window.location.href = destinationFor(data.mustChangePassword);
    } catch {
      setError("Network error.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <MarbleBackdrop />
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-sage-btn text-sage-text carved-btn-sage">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M3 10h18M8 2v4M16 2v4" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-ink-primary etched-deep">NCPA Venue for Hire</h1>
          <p className="mt-1 text-sm text-ink-muted etched">
            {phase === "credentials" ? "Sign in to the operations workspace" : "Enter your verification code"}
          </p>
        </div>

        {phase === "credentials" ? (
          <form onSubmit={onLogin} className="carved-card rounded-2xl bg-marble-highlight/60 p-6 backdrop-blur-sm">
            {stateMessage && (
              <div role="status" className="mb-4 rounded-lg bg-sage/10 px-3 py-2 text-xs text-sage-text">
                {stateMessage}
              </div>
            )}
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
            <label className="mb-2 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-sage etched">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                autoComplete="current-password"
              />
            </label>
            <Link to="/forgot-password" className="mb-4 block text-right text-xs text-ink-muted hover:text-sage-text">
              Forgot password?
            </Link>
            {error && (
              <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="carved-btn-sage w-full rounded-full bg-sage-btn py-2.5 text-sm font-semibold text-sage-text etched disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={onMfa} className="carved-card rounded-2xl bg-marble-highlight/60 p-6 backdrop-blur-sm">
            <p className="mb-4 text-xs text-ink-secondary etched">
              Open your authenticator app (Google Authenticator, 1Password, etc.) and enter the 6-digit code.
            </p>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-sage etched">
                {useRecovery ? "Recovery code" : "Authentication code"}
              </span>
              <input
                type="text"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm tracking-widest text-ink-primary focus:outline-none"
                placeholder={useRecovery ? "XXXXX-XXXXX" : "000000"}
              />
            </label>
            <label className="mb-4 flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={useRecovery}
                onChange={(e) => setUseRecovery(e.target.checked)}
                className="accent-sage"
              />
              Use a recovery code instead
            </label>
            {error && (
              <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="carved-btn-sage w-full rounded-full bg-sage-btn py-2.5 text-sm font-semibold text-sage-text etched disabled:opacity-60"
            >
              {loading ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase("credentials");
                setCode("");
                setError(null);
              }}
              className="mt-3 w-full text-xs text-ink-muted hover:text-ink-secondary"
            >
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
