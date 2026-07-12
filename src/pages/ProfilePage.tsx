import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../lib/auth";
import { describeAccess } from "../../worker/lib/rbac";
import { apiPost } from "../lib/api";

type MfaStatus = { enrolled: boolean; recoveryCodesRemaining?: number };
type SetupResponse = { secret: string; uri: string };
type ConfirmResponse = { recoveryCodes: string[] };

export function ProfilePage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const forcePasswordChange = searchParams.get("forcePasswordChange") === "1";
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [setupPassword, setSetupPassword] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/mfa/status", { credentials: "include" })
      .then(async (res): Promise<MfaStatus | null> => res.ok ? ((await res.json()) as MfaStatus) : null)
      .then((data) => {
        if (!cancelled) setMfaStatus(data ?? { enrolled: false });
      })
      .catch(() => {
        if (!cancelled) setMfaStatus({ enrolled: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!setup) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(setup.uri, { margin: 1, width: 200, color: { dark: "#5C5850", light: "#FEFEFE" } })
        .then((url) => {
          if (!cancelled) setQrDataUrl(url);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [setup]);

  async function beginSetup() {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: setupPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as SetupResponse & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not start setup.");
        setBusy(false);
        return;
      }
      setSetup({ secret: data.secret, uri: data.uri });
    } catch {
      setError("Network error.");
    }
    setBusy(false);
  }

  async function confirmSetup() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: confirmCode }),
      });
      const data = (await res.json().catch(() => ({}))) as ConfirmResponse & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Invalid code.");
        setBusy(false);
        return;
      }
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setConfirmCode("");
      setSetupPassword("");
      setMfaStatus({ enrolled: true });
      setMsg("MFA enabled. Save your recovery codes below — they are shown only once.");
    } catch {
      setError("Network error.");
    }
    setBusy(false);
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwMsg(null);
    if (newPassword !== confirmPassword) {
      setPwError("New passwords don't match.");
      return;
    }
    setPwBusy(true);
    try {
      await apiPost("/auth/password/change", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwMsg("Password changed. You've been signed out of any other devices.");
    } catch (err) {
      setPwError((err as Error).message);
    }
    setPwBusy(false);
  }

  if (!user) return null;

  return (
    <div>
      <PageHeader title="Profile & Security" subtitle="Manage your account, password, and multi-factor authentication" />

      {forcePasswordChange && (
        <div role="alert" className="mb-6 rounded-lg bg-status-awaitingApproval/10 px-4 py-3 text-sm text-status-awaitingApproval etched">
          Your password was reset by an administrator. Please choose a new password below before continuing.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sage etched">Account</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Name</dt>
              <dd className="font-medium text-ink-primary etched-deep">{user.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Email</dt>
              <dd className="font-medium text-ink-primary etched-deep">{user.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Access</dt>
              <dd className="font-medium text-ink-primary etched-deep">{describeAccess(user.permissions)}</dd>
            </div>
          </dl>
        </section>

        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-sage etched">Multi-Factor Authentication</h2>
          <p className="mb-4 text-xs text-ink-muted etched">
            {mfaStatus?.enrolled
              ? "MFA is enabled on your account."
              : "Protect your account with a TOTP authenticator app."}
          </p>

          {msg && (
            <div role="status" className="mb-4 rounded-lg bg-sage/10 px-3 py-2 text-xs text-sage-text">
              {msg}
            </div>
          )}
          {error && (
            <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">
              {error}
            </div>
          )}

          {!mfaStatus?.enrolled && !setup && !recoveryCodes && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-sage etched">Confirm with your password to begin setup</span>
              <input
                type="password"
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                className="carved mb-3 w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                autoComplete="current-password"
              />
              <button
                type="button"
                disabled={busy || !setupPassword}
                onClick={beginSetup}
                className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
              >
                Begin MFA setup
              </button>
            </label>
          )}

          {mfaStatus?.enrolled && !recoveryCodes && (
            <p className="text-xs text-ink-secondary etched">
              Recovery codes remaining: {mfaStatus.recoveryCodesRemaining ?? "—"}
            </p>
          )}

          {setup && (
            <div className="space-y-3">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Scan this QR code in your authenticator app" className="mx-auto rounded-lg" width={200} height={200} />
              ) : (
                <div className="mx-auto h-[200px] w-[200px] animate-pulse rounded-lg bg-marble-shadow/40" />
              )}
              <p className="text-center text-xs text-ink-muted etched">
                Or enter this secret manually:{" "}
                <code className="rounded bg-marble-shadow/60 px-1.5 py-0.5 font-mono text-[11px] text-ink-primary">{setup.secret}</code>
              </p>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-sage etched">Enter the 6-digit code from your app</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-center text-sm tracking-widest text-ink-primary focus:outline-none"
                  placeholder="000000"
                />
              </label>
              <button
                type="button"
                disabled={busy || confirmCode.length < 6}
                onClick={confirmSetup}
                className="carved-btn-terracotta w-full rounded-full bg-terracotta-btn py-2.5 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
              >
                {busy ? "Confirming…" : "Confirm & enable"}
              </button>
            </div>
          )}

          {recoveryCodes && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-status-awaitingApproval etched">
                ⚠ Save these recovery codes securely. Each can be used once if you lose your authenticator.
              </p>
              <div className="carved grid grid-cols-2 gap-2 rounded-xl bg-marble-shadow/40 p-4 font-mono text-xs text-ink-primary">
                {recoveryCodes.map((c) => (
                  <div key={c}>{c}</div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRecoveryCodes(null)}
                className="carved-btn w-full rounded-full bg-neutral-btn py-2 text-sm font-medium text-ink-secondary etched"
              >
                Done
              </button>
            </div>
          )}
        </section>

        <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-sage etched">Change Password</h2>
          <p className="mb-4 text-xs text-ink-muted etched">
            Changing your password signs you out of any other devices.
          </p>

          {pwMsg && (
            <div role="status" className="mb-4 rounded-lg bg-sage/10 px-3 py-2 text-xs text-sage-text">
              {pwMsg}
            </div>
          )}
          {pwError && (
            <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">
              {pwError}
            </div>
          )}

          <form onSubmit={onChangePassword}>
            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-semibold text-sage etched">Current password</span>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                autoComplete="current-password"
              />
            </label>
            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-semibold text-sage etched">New password</span>
              <input
                type="password"
                required
                minLength={10}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                autoComplete="new-password"
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-sage etched">Confirm new password</span>
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
            <button
              type="submit"
              disabled={pwBusy || !currentPassword || newPassword.length < 10}
              className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
            >
              {pwBusy ? "Changing…" : "Change password"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
