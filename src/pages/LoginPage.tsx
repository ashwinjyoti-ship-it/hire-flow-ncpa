import { useState } from "react";
import { MarbleBackdrop } from "../components/MarbleBackdrop";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
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
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Sign-in failed.");
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { mfaRequired?: boolean };
      if (data.mfaRequired) {
        // Phase 3: route to MFA verification.
        setError("MFA challenge required. (Configured in Phase 3.)");
        setLoading(false);
        return;
      }
      window.location.href = "/dashboard";
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
          <p className="mt-1 text-sm text-ink-muted etched">Sign in to the operations workspace</p>
        </div>
        <form onSubmit={onSubmit} className="carved-card rounded-2xl bg-marble-highlight/60 p-6 backdrop-blur-sm">
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
          <label className="mb-4 block">
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
      </div>
    </div>
  );
}
