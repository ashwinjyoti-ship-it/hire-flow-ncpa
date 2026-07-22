import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import { apiGet, apiPost, apiPut, apiDelete } from "../lib/api";
import { useTheme } from "../lib/theme";
type Settings = {
  resend: { configured: boolean; keyHint: string | null; source: string };
  mailFrom: string;
  brief: BriefSettings;
  briefDefaults: BriefSettings;
  checklistIntervals: ChecklistIntervals;
  checklistIntervalMeta: ChecklistIntervalMeta[];
  checklistIntervalDefaults: ChecklistIntervals;
};

type BriefSettings = {
  morning_time: string;
  evening_time: string;
  email_enabled: boolean;
  email_recipients: string[];
  stale_enquiry_days: number;
  readiness_window_days: number;
  readiness_threshold: number;
  conflict_window_days: number;
  overdue_list_cap: number;
};

type ChecklistIntervals = {
  approval_followup: number;
  instalment: number;
  confirmation_letter: number;
  onstage: number;
  technical_meeting: number;
  feedback: number;
  accounts_file: number;
  accounts_file_send_back: number;
  send_file_to_accounts: number;
  tds_send_to_accounts: number;
};

type ChecklistIntervalMeta = {
  key: keyof ChecklistIntervals;
  label: string;
  description: string;
};

const DEFAULT_CHECKLIST_INTERVALS: ChecklistIntervals = {
  approval_followup: 7,
  instalment: 0,
  confirmation_letter: 3,
  onstage: 3,
  technical_meeting: 0,
  feedback: 5,
  accounts_file: 3,
  accounts_file_send_back: 3,
  send_file_to_accounts: 1,
  tds_send_to_accounts: 0,
};

const DEFAULT_CHECKLIST_INTERVAL_META: ChecklistIntervalMeta[] = [
  { key: "approval_followup", label: "Approval follow-up", description: "Days after Approval Sent On before the follow-up task is due." },
  { key: "instalment", label: "Installment follow-up", description: "Days after each installment expected date (0 = due on that date)." },
  { key: "confirmation_letter", label: "Confirmation letter follow-up", description: "Days after Confirmation Letter is couriered." },
  { key: "onstage", label: "OnStage follow-up", description: "Days after OnStage is asked of the client." },
  { key: "technical_meeting", label: "Technical meeting", description: "Days after the technical meeting date (0 = due on that date)." },
  { key: "feedback", label: "Feedback follow-up", description: "Days after the feedback form is sent." },
  { key: "accounts_file", label: "Accounts file follow-up", description: "Days after a file is with Accounts before a follow-up task is due." },
  { key: "accounts_file_send_back", label: "Accounts file send-back", description: "Days after an edit is received from Accounts before the send-back task is due." },
  { key: "send_file_to_accounts", label: "Send file to accounts", description: "Days after the final show date to create the Send file to accounts task." },
  { key: "tds_send_to_accounts", label: "Send TDS certificate to Accounts", description: "Days after TDS is received from the client before the send-to-Accounts task is due (0 = due on that date)." },
];

async function fetchSettings(): Promise<Settings> {
  const res = await fetch("/api/settings", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load settings");
  return (await res.json()) as Settings;
}

/**
 * Collapsible settings panel. Header doubles as a toggle button with a rotating
 * chevron. Auto-opens when the URL hash matches `id` (so deep links like
 * /settings#team-accounts from UserManagementPage still land on an open panel).
 * Legacy hash `#event-owners` also opens the team-accounts panel.
 */
function CollapsibleSection({
  id,
  title,
  description,
  defaultOpen = false,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const matchesHash = (sectionId: string) => {
    if (typeof window === "undefined") return false;
    const hash = window.location.hash;
    if (hash === `#${sectionId}`) return true;
    // Legacy deep link from before the Team accounts rename.
    return sectionId === "team-accounts" && hash === "#event-owners";
  };
  const [open, setOpen] = useState(defaultOpen || Boolean(id && matchesHash(id)));

  // Respect a deep link that arrives after first paint (e.g. client-side nav).
  useEffect(() => {
    if (!id) return;
    if (matchesHash(id)) setOpen(true);
  }, [id]);

  return (
    <section id={id} className="carved-card overflow-hidden rounded-2xl bg-marble-highlight/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-6 py-5 text-left transition-colors hover:bg-marble-shadow/30 focus:outline-none"
      >
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">{title}</h2>
          <p className="mt-1 text-xs text-ink-muted etched">{description}</p>
        </div>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={"mt-0.5 shrink-0 text-ink-secondary transition-transform duration-200 " + (open ? "rotate-180" : "")}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="border-t border-ink-muted/10 p-6">{children}</div>}
    </section>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [apiKey, setApiKey] = useState("");
  const [mailFrom, setMailFrom] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [briefRecipientsText, setBriefRecipientsText] = useState("");
  const [briefEmailEnabled, setBriefEmailEnabled] = useState(true);
  const [morningTime, setMorningTime] = useState("07:30");
  const [eveningTime, setEveningTime] = useState("18:30");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState("");
  const [tempPassword, setTempPassword] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.mailFrom) setMailFrom(data.mailFrom);
  }, [data?.mailFrom]);

  useEffect(() => {
    if (!data?.brief) return;
    setBriefRecipientsText(data.brief.email_recipients.join("\n"));
    setBriefEmailEnabled(data.brief.email_enabled);
    setMorningTime(data.brief.morning_time);
    setEveningTime(data.brief.evening_time);
  }, [data?.brief]);

  const saveKey = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch("/api/settings/resend", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apiKey: key }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to save");
    },
    onSuccess: () => {
      setApiKey("");
      setMsg("Resend API key saved.");
      setError(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const clearKey = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/resend", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to clear");
    },
    onSuccess: () => {
      setMsg("Resend API key cleared.");
      setError(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const sendTest = useMutation({
    mutationFn: async (to: string) => {
      const res = await fetch("/api/settings/resend/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) throw new Error(body.error ?? "Test failed");
    },
    onSuccess: () => {
      setMsg("Test email sent — check the recipient inbox.");
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const saveMailFrom = useMutation({
    mutationFn: async (mf: string) => {
      const res = await fetch("/api/settings/mail-from", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mailFrom: mf }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to save");
    },
    onSuccess: () => {
      setMsg("From address saved.");
      setError(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const saveBrief = useMutation({
    mutationFn: async () => {
      const recipients = briefRecipientsText
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/settings/brief", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          morning_time: morningTime,
          evening_time: eveningTime,
          email_enabled: briefEmailEnabled,
          email_recipients: recipients,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to save report email settings");
    },
    onSuccess: () => {
      setMsg("Report email settings saved.");
      setError(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const adminReset = useMutation({
    mutationFn: async (email: string) => apiPost<{ email: string; temporaryPassword: string }>("/auth/password/admin-reset", { email }),
    onSuccess: (data) => {
      setTempPassword(data);
      setResetEmail("");
      setResetError(null);
    },
    onError: (e: Error) => setResetError(e.message),
  });

  const isAdmin = can(user?.permissions, "settings.manage");

  return (
    <div>
      <PageHeader title="Settings" subtitle="Application configuration" />

      {msg && (
        <div role="status" className="mb-4 rounded-lg bg-sage/10 px-4 py-2 text-sm text-sage-text">
          {msg}
        </div>
      )}
      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-4 py-2 text-sm text-status-cancelled">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : (
        <div className="space-y-6">
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Appearance</h2>
                <p className="mt-1 text-xs text-ink-muted etched">Use a darker, low-light interface on this device.</p>
              </div>
              <label className="flex cursor-pointer items-center gap-3">
                <span className="text-sm font-medium text-ink-secondary etched">Dark mode</span>
                <span className="relative inline-flex">
                  <input
                    type="checkbox"
                    checked={theme === "dark"}
                    onChange={(event) => setTheme(event.target.checked ? "dark" : "light")}
                    className="peer sr-only"
                    aria-label="Enable dark mode"
                  />
                  <span className="carved h-6 w-11 rounded-full bg-marble-shadow/70 transition-colors peer-checked:bg-sage-dark" aria-hidden />
                  <span className="pointer-events-none absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-marble-highlight text-[11px] text-ink-secondary transition-transform peer-checked:translate-x-5 peer-checked:bg-marble-btnLight" aria-hidden>
                    {theme === "dark" ? "☾" : "☀"}
                  </span>
                </span>
              </label>
            </div>
          </section>

          {/* Resend / email configuration */}
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-ink-muted/10 pb-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Email Configuration</h2>
                <p className="mt-1 text-xs text-ink-muted etched">
                  Resend delivers outbound mail. Configure the API key, sender, and who receives the twice-daily reports.
                </p>
              </div>
              <ConfiguredBadge configured={data?.resend.configured ?? false} />
            </div>

            {isAdmin ? (
              <div className="space-y-8">
                <div className="rounded-xl bg-marble-shadow/25 px-4 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted etched">What Resend sends today</h3>
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-secondary etched">
                    <li>
                      <span className="font-medium text-ink-primary">Morning Brief / Evening Debrief</span>
                      {" "}— HTML digests at the times below, to the report recipients list (not every login).
                    </li>
                    <li>
                      <span className="font-medium text-ink-primary">Password reset</span>
                      {" "}— one-time link to the address on the forgot-password form.
                    </li>
                    <li>
                      <span className="font-medium text-ink-primary">Settings test</span>
                      {" "}— the “Send test” button below, to verify the key and from-address.
                    </li>
                    <li>
                      <span className="font-medium text-ink-primary">Task due / assignment alerts</span>
                      {" "}— in-app only right now (bell). The email queue exists but is not turned on for those yet.
                    </li>
                  </ul>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                  <div className="min-w-0">
                    <h3 className="mb-3 text-sm font-semibold text-ink-primary etched-deep">Resend API</h3>
                    {data?.resend.configured && (
                      <p className="mb-3 text-xs text-ink-secondary etched">
                        Current key: <code className="rounded bg-marble-shadow/60 px-1.5 py-0.5 font-mono text-[11px]">{data.resend.keyHint}</code>{" "}
                        <span className="text-ink-muted">(source: {data.resend.source})</span>
                      </p>
                    )}
                    <label className="mb-3 block">
                      <span className="mb-1.5 block text-xs font-semibold text-sage etched">API key</span>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="re_…"
                        className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                        autoComplete="off"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saveKey.isPending || apiKey.length < 10}
                        onClick={() => saveKey.mutate(apiKey)}
                        className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
                      >
                        {saveKey.isPending ? "Saving…" : "Save key"}
                      </button>
                      {data?.resend.configured && (
                        <button
                          type="button"
                          disabled={clearKey.isPending}
                          onClick={() => clearKey.mutate()}
                          className="carved-btn rounded-full bg-neutral-btn px-5 py-2 text-sm font-medium text-ink-secondary etched disabled:opacity-60"
                        >
                          {clearKey.isPending ? "Clearing…" : "Clear"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 border-t border-ink-muted/10 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                    <h3 className="mb-3 text-sm font-semibold text-ink-primary etched-deep">Sender & Test</h3>
                    <label className="mb-3 block">
                      <span className="mb-1.5 block text-xs font-semibold text-sage etched">From address</span>
                      <input
                        type="text"
                        value={mailFrom}
                        onChange={(e) => setMailFrom(e.target.value)}
                        placeholder="NCPA Venue Hire <noreply@example.com>"
                        className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={saveMailFrom.isPending || !mailFrom.trim() || mailFrom === data?.mailFrom}
                      onClick={() => saveMailFrom.mutate(mailFrom.trim())}
                      className="carved-btn-terracotta mb-5 rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
                    >
                      {saveMailFrom.isPending ? "Saving…" : "Save from address"}
                    </button>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-sage etched">Send a test email</span>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="email"
                          value={testEmail}
                          onChange={(e) => setTestEmail(e.target.value)}
                          className="carved min-w-0 flex-1 rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                          placeholder="recipient@example.com"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          disabled={sendTest.isPending || !data?.resend.configured || !testEmail.trim()}
                          onClick={() => sendTest.mutate(testEmail.trim())}
                          className="carved-btn rounded-full bg-neutral-btn px-5 py-2 text-sm font-medium text-ink-secondary etched disabled:opacity-60"
                        >
                          {sendTest.isPending ? "Sending…" : "Send test"}
                        </button>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="border-t border-ink-muted/10 pt-6">
                  <h3 className="mb-1 text-sm font-semibold text-ink-primary etched-deep">Report emails (Morning / Evening briefs)</h3>
                  <p className="mb-4 text-xs text-ink-muted etched">
                    Digests go only to the addresses listed here. Default is{" "}
                    <code className="rounded bg-marble-shadow/60 px-1.5 py-0.5 font-mono text-[11px]">
                      {data?.briefDefaults.email_recipients[0] ?? "nkotwal@ncpamumbai.com"}
                    </code>
                    . One address per line (or comma-separated).
                  </p>

                  <label className="mb-4 flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={briefEmailEnabled}
                      onChange={(e) => setBriefEmailEnabled(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-ink-muted"
                    />
                    <span className="text-sm text-ink-secondary etched">
                      Email briefs automatically when Resend is configured
                    </span>
                  </label>

                  <div className="mb-4 grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-sage etched">Morning send (IST)</span>
                      <input
                        type="time"
                        value={morningTime}
                        onChange={(e) => setMorningTime(e.target.value)}
                        className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-sage etched">Evening send (IST)</span>
                      <input
                        type="time"
                        value={eveningTime}
                        onChange={(e) => setEveningTime(e.target.value)}
                        className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                      />
                    </label>
                  </div>

                  <label className="mb-3 block">
                    <span className="mb-1.5 block text-xs font-semibold text-sage etched">Report recipients</span>
                    <textarea
                      value={briefRecipientsText}
                      onChange={(e) => setBriefRecipientsText(e.target.value)}
                      rows={3}
                      placeholder="nkotwal@ncpamumbai.com"
                      className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 font-mono text-sm text-ink-primary focus:outline-none"
                    />
                  </label>

                  <button
                    type="button"
                    disabled={saveBrief.isPending}
                    onClick={() => saveBrief.mutate()}
                    className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
                  >
                    {saveBrief.isPending ? "Saving…" : "Save report email settings"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-ink-secondary etched">{data?.mailFrom ?? "—"}</p>
                <p className="mt-1 text-xs text-ink-muted etched">Only admins can change email settings.</p>
              </div>
            )}
          </section>

          {isAdmin && (
            <CollapsibleSection
              id="checklist-intervals"
              title="Check List Intervals"
              description="How many days after each checklist trigger a follow-up task becomes due. Defaults match the previous hardcoded values."
            >
              <ChecklistIntervalsSection
                intervals={data?.checklistIntervals ?? DEFAULT_CHECKLIST_INTERVALS}
                meta={data?.checklistIntervalMeta ?? DEFAULT_CHECKLIST_INTERVAL_META}
                defaults={data?.checklistIntervalDefaults ?? DEFAULT_CHECKLIST_INTERVALS}
                onSaved={() => {
                  setMsg("Checklist intervals saved.");
                  setError(null);
                  qc.invalidateQueries({ queryKey: ["settings"] });
                }}
                onError={(message) => setError(message)}
              />
            </CollapsibleSection>
          )}

          {isAdmin && (
            <CollapsibleSection
              id="team-accounts"
              title="Team accounts"
              description="Create a login (name, email, one-time password). Tick Event owner so they can own events. Contact is only needed if they are also a programme officer."
              defaultOpen
            >
              <TeamAccountsSection />
            </CollapsibleSection>
          )}

          {isAdmin && (
            <CollapsibleSection
              id="programme-officers"
              title="Programme officers"
              description="Name and contact only — no login. Appears in the Program Officer dropdown on the event form."
            >
              <ProgrammeOfficersSection />
            </CollapsibleSection>
          )}

          {isAdmin && (
            <CollapsibleSection
              title="Master Lists"
              description="Manage the Caterer and Decorator option lists used in the Add Event form. Deactivating soft-deletes the option (existing events keep their value)."
            >
              <MasterListsSection listKeys={["caterer", "decorator"]} />
            </CollapsibleSection>
          )}

          {isAdmin && (
            <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
              <div className="mb-5 border-b border-ink-muted/10 pb-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Reset a User's Password</h2>
                <p className="mt-1 text-xs text-ink-muted etched">
                  Issues a one-time temporary password and signs the user out everywhere. They'll be
                  prompted to choose their own password on next sign-in. Use this when a user has lost
                  access and email-based reset isn't an option.
                </p>
              </div>

              {resetError && (
                <div role="alert" className="mb-3 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">
                  {resetError}
                </div>
              )}

              {tempPassword ? (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-status-awaitingApproval etched">
                    ⚠ Share this password with {tempPassword.email} securely — it is shown only once.
                  </p>
                  <code className="carved block rounded-xl bg-marble-shadow/40 px-4 py-2.5 font-mono text-sm text-ink-primary">
                    {tempPassword.temporaryPassword}
                  </code>
                  <button
                    type="button"
                    onClick={() => setTempPassword(null)}
                    className="carved-btn rounded-full bg-neutral-btn px-5 py-2 text-sm font-medium text-ink-secondary etched"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="carved min-w-0 flex-1 rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={adminReset.isPending || !resetEmail.trim()}
                    onClick={() => adminReset.mutate(resetEmail.trim())}
                    className="carved-btn-terracotta shrink-0 rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
                  >
                    {adminReset.isPending ? "Resetting…" : "Reset password"}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ConfiguredBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/15 px-2.5 py-1 text-[11px] font-medium text-sage-text etched">
      <span className="h-1.5 w-1.5 rounded-full bg-sage" /> Configured
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-status-awaitingApproval/15 px-2.5 py-1 text-[11px] font-medium text-status-awaitingApproval etched">
      <span className="h-1.5 w-1.5 rounded-full bg-status-awaitingApproval" /> Not configured
    </span>
  );
}

function ChecklistIntervalsSection({
  intervals,
  meta,
  defaults,
  onSaved,
  onError,
}: {
  intervals: ChecklistIntervals;
  meta: ChecklistIntervalMeta[];
  defaults: ChecklistIntervals;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<ChecklistIntervals>(intervals);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(intervals);
  }, [intervals]);

  const dirty = meta.some((item) => draft[item.key] !== intervals[item.key]);

  const save = useMutation({
    mutationFn: async (next: ChecklistIntervals) => {
      const res = await fetch("/api/settings/checklist-intervals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(next),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to save intervals");
      return next;
    },
    onSuccess: () => {
      setLocalError(null);
      onSaved();
    },
    onError: (e: Error) => {
      setLocalError(e.message);
      onError(e.message);
    },
  });

  function setDays(key: keyof ChecklistIntervals, raw: string) {
    const n = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    setDraft((prev) => ({ ...prev, [key]: Math.min(365, Math.floor(n)) }));
  }

  return (
    <div className="space-y-4">
      {localError && (
        <div role="alert" className="rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">
          {localError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {meta.map((item) => (
          <label key={item.key} className="block">
            <span className="mb-1.5 block text-xs font-semibold text-sage etched">{item.label}</span>
            <p className="mb-2 text-[11px] leading-snug text-ink-muted etched">{item.description}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={365}
                step={1}
                value={draft[item.key]}
                onChange={(e) => setDays(item.key, e.target.value)}
                className="carved w-24 rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
              <span className="text-xs text-ink-muted etched">
                days
                {draft[item.key] !== defaults[item.key] ? (
                  <span className="ml-1 text-ink-secondary">(default {defaults[item.key]})</span>
                ) : null}
              </span>
            </div>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={save.isPending || !dirty}
          onClick={() => save.mutate(draft)}
          className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
        >
          {save.isPending ? "Saving…" : "Save intervals"}
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => setDraft({ ...defaults })}
          className="carved-btn rounded-full bg-neutral-btn px-5 py-2 text-sm font-medium text-ink-secondary etched disabled:opacity-60"
        >
          Reset to defaults
        </button>
      </div>
      <p className="text-[11px] text-ink-muted etched">
        Changes apply to newly generated tasks. Existing open tasks keep their current due dates.
      </p>
    </div>
  );
}

// ---- Master Lists section: admin CRUD for Add Event dropdowns ----
type LookupOption = {
  id: string;
  value: string;
  sort_order: number;
  is_active: number;
  metadata?: Record<string, unknown> | null;
};

const LIST_LABELS: Record<string, string> = {
  handled_by: "Event Owners",
  caterer: "Caterers",
  decorator: "Decorators",
  program_officer: "Programme officers",
};

/** Programme officers: name + contact only (no login account). */
function ProgrammeOfficersSection() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [editing, setEditing] = useState<Record<string, { value: string; contact: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const [showDeactivated, setShowDeactivated] = useState(false);

  const { data, isLoading } = useQuery<{ options: LookupOption[] }>({
    queryKey: ["lookup", "program_officer"],
    queryFn: () => apiGet("/lookups/program_officer"),
  });

  const add = useMutation({
    mutationFn: async () =>
      apiPost("/lookups/program_officer", {
        value: newName.trim(),
        metadata: { contact_number: newContact.trim() },
      }),
    onSuccess: () => {
      setNewName("");
      setNewContact("");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["lookup", "program_officer"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, value, contact }: { id: string; value: string; contact: string }) =>
      apiPut(`/lookups/program_officer/${id}`, {
        value,
        metadata: { contact_number: contact },
      }),
    onSuccess: () => {
      setEditing({});
      setErr(null);
      qc.invalidateQueries({ queryKey: ["lookup", "program_officer"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      apiPut(`/lookups/program_officer/${id}`, { is_active: active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lookup", "program_officer"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiDelete(`/lookups/program_officer/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lookup", "program_officer"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const options = data?.options ?? [];
  const activeOptions = options.filter((o) => o.is_active);
  const deactivatedOptions = options.filter((o) => !o.is_active);
  const contactOf = (o: LookupOption) =>
    typeof o.metadata?.contact_number === "string" ? o.metadata.contact_number : "";

  const renderOptionRow = (o: LookupOption) => {
    const ed = editing[o.id];
    return (
      <li key={o.id} className="rounded-xl bg-marble-shadow/30 px-4 py-3">
        {ed ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={ed.value}
              onChange={(e) => setEditing((s) => ({ ...s, [o.id]: { ...ed, value: e.target.value } }))}
              className="carved min-w-0 flex-1 rounded-lg bg-marble-highlight/60 px-2 py-1 text-sm text-ink-primary focus:outline-none"
            />
            <input
              value={ed.contact}
              onChange={(e) => setEditing((s) => ({ ...s, [o.id]: { ...ed, contact: e.target.value } }))}
              placeholder="Contact no."
              className="carved w-40 rounded-lg bg-marble-highlight/60 px-2 py-1 text-sm text-ink-primary focus:outline-none"
            />
            <button
              type="button"
              disabled={update.isPending || !ed.value.trim() || !ed.contact.trim()}
              onClick={() => update.mutate({ id: o.id, value: ed.value.trim(), contact: ed.contact.trim() })}
              className="text-xs font-semibold text-sage-text hover:underline disabled:opacity-40"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing((s) => { const n = { ...s }; delete n[o.id]; return n; })} className="text-xs text-ink-muted hover:underline">Cancel</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <span className={"text-sm font-medium " + (o.is_active ? "text-ink-primary etched-deep" : "text-ink-muted line-through")}>{o.value}</span>
              {contactOf(o) && <span className="ml-2 text-sm tabular-nums text-ink-secondary etched">{contactOf(o)}</span>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => setEditing((s) => ({ ...s, [o.id]: { value: o.value, contact: contactOf(o) } }))}
                className="text-xs text-sage-text hover:underline"
              >
                Edit
              </button>
              <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: o.id, active: !o.is_active })} className="text-xs text-ink-secondary hover:underline">
                {o.is_active ? "Deactivate" : "Activate"}
              </button>
              <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(o.id)} className="text-xs text-status-cancelled hover:underline">Delete</button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div>
      {err && <div role="alert" className="mb-3 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">{err}</div>}

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Name"
          className="carved rounded-lg bg-marble-highlight/60 px-3 py-2 text-sm text-ink-primary focus:outline-none"
        />
        <input
          value={newContact}
          onChange={(e) => setNewContact(e.target.value)}
          placeholder="Contact no."
          className="carved rounded-lg bg-marble-highlight/60 px-3 py-2 text-sm text-ink-primary focus:outline-none"
        />
        <button
          type="button"
          disabled={add.isPending || !newName.trim() || !newContact.trim()}
          onClick={() => add.mutate()}
          className="carved-btn-sage rounded-full bg-sage-btn px-4 py-2 text-xs font-semibold text-sage-text etched disabled:opacity-60"
        >
          {add.isPending ? "Adding…" : "+ Add"}
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-muted etched">Loading…</p>
      ) : activeOptions.length === 0 && deactivatedOptions.length === 0 ? (
        <p className="text-sm text-ink-muted etched">No programme officers yet.</p>
      ) : (
        <>
          {activeOptions.length === 0 ? (
            <p className="text-sm text-ink-muted etched">No active programme officers.</p>
          ) : (
            <ul className="space-y-2">
              {activeOptions.map(renderOptionRow)}
            </ul>
          )}

          {deactivatedOptions.length > 0 && (
            <div className="mt-4 border-t border-ink-muted/10 pt-3">
              <button
                type="button"
                onClick={() => setShowDeactivated((o) => !o)}
                aria-expanded={showDeactivated}
                className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted etched hover:text-ink-secondary"
              >
                <span>Deactivated ({deactivatedOptions.length})</span>
                <span aria-hidden="true">{showDeactivated ? "▴" : "▾"}</span>
              </button>
              {showDeactivated && (
                <ul className="mt-2 space-y-2">
                  {deactivatedOptions.map(renderOptionRow)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MasterListsSection({ listKeys }: { listKeys: string[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Record<string, { id: string; value: string } | null>>({});
  const [newVal, setNewVal] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  return (
    <div>
      {err && <div role="alert" className="mb-3 rounded-lg bg-status-cancelled/10 px-3 py-1.5 text-xs text-status-cancelled">{err}</div>}
      <div className="grid gap-6 lg:grid-cols-3">
        {listKeys.map((listKey) => (
          <ListEditor
            key={listKey}
            listKey={listKey}
            editingId={editing[listKey]?.id ?? null}
            editingValue={editing[listKey]?.value ?? ""}
            onEditChange={(id, value) => setEditing((s) => ({ ...s, [listKey]: id ? { id, value } : null }))}
            newValue={newVal[listKey] ?? ""}
            onNewChange={(v) => setNewVal((s) => ({ ...s, [listKey]: v }))}
            onInvalidate={() => { qc.invalidateQueries({ queryKey: ["lookups"] }); setErr(null); }}
            onError={(m) => setErr(m)}
          />
        ))}
      </div>
    </div>
  );
}

function ListEditor({
  listKey, editingId, editingValue, onEditChange, newValue, onNewChange, onInvalidate, onError,
}: {
  listKey: string;
  editingId: string | null;
  editingValue: string;
  onEditChange: (id: string | null, value: string) => void;
  newValue: string;
  onNewChange: (v: string) => void;
  onInvalidate: () => void;
  onError: (m: string) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ options: LookupOption[] }>({
    queryKey: ["lookup", listKey],
    queryFn: () => apiGet(`/lookups/${listKey}`),
  });

  const add = useMutation({
    mutationFn: async (value: string) => apiPost(`/lookups/${listKey}`, { value }),
    onSuccess: () => { onNewChange(""); qc.invalidateQueries({ queryKey: ["lookup", listKey] }); onInvalidate(); },
    onError: (e: Error) => onError(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => apiPut(`/lookups/${listKey}/${id}`, { value }),
    onSuccess: () => { onEditChange(null, ""); qc.invalidateQueries({ queryKey: ["lookup", listKey] }); onInvalidate(); },
    onError: (e: Error) => onError(e.message),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => apiPut(`/lookups/${listKey}/${id}`, { is_active: active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lookup", listKey] }); onInvalidate(); },
    onError: (e: Error) => onError(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiDelete(`/lookups/${listKey}/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lookup", listKey] }); onInvalidate(); },
    onError: (e: Error) => onError(e.message),
  });

  const options = data?.options ?? [];
  const title = LIST_LABELS[listKey] ?? listKey[0]!.toUpperCase() + listKey.slice(1);

  return (
    <div className="min-w-0">
      <h3 className="mb-3 text-sm font-semibold text-ink-primary etched-deep">{title}</h3>
      {isLoading ? <p className="text-xs text-ink-muted etched">Loading…</p> : (
        <ul className="mb-3 divide-y divide-ink-muted/10 border-y border-ink-muted/10">
          {options.length === 0 && <li className="text-xs text-ink-muted etched">No options yet.</li>}
          {options.map((o) => (
            <li key={o.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
              {editingId === o.id ? (
                <>
                  <input value={editingValue} onChange={(e) => onEditChange(o.id, e.target.value)} className="carved min-w-0 flex-1 rounded-lg bg-marble-highlight/60 px-2 py-1 text-sm text-ink-primary focus:outline-none" />
                  <div className="flex shrink-0 gap-3">
                    <button type="button" disabled={update.isPending} onClick={() => update.mutate({ id: o.id, value: editingValue.trim() })} className="text-xs text-sage-text hover:underline">Save</button>
                    <button type="button" onClick={() => onEditChange(null, "")} className="text-xs text-ink-muted hover:underline">Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <span className={"min-w-0 flex-1 text-sm " + (o.is_active ? "text-ink-primary etched-deep" : "text-ink-muted line-through")}>{o.value}</span>
                  <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1">
                    <button type="button" onClick={() => onEditChange(o.id, o.value)} className="text-xs text-sage-text hover:underline">Edit</button>
                    <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: o.id, active: !o.is_active })} className="text-xs text-ink-secondary hover:underline">{o.is_active ? "Deactivate" : "Activate"}</button>
                    <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(o.id)} className="text-xs text-status-cancelled hover:underline">Delete</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input value={newValue} onChange={(e) => onNewChange(e.target.value)} placeholder={`Add ${title.toLowerCase()}…`} className="carved flex-1 rounded-lg bg-marble-highlight/60 px-2 py-1.5 text-sm text-ink-primary focus:outline-none" />
        <button type="button" disabled={add.isPending || !newValue.trim()} onClick={() => add.mutate(newValue.trim())} className="carved-btn-sage rounded-full bg-sage-btn px-4 py-1.5 text-xs font-semibold text-sage-text etched disabled:opacity-60">Add</button>
      </div>
    </div>
  );
}

// ---- Team accounts ----
// Logins for people who need to sign in. Permissions stay on the backend
// (API default = event-manager access); the UI does not expose presets or
// permission checkboxes. Event owner / also-PO are the only designations here.
type TeamUser = {
  id: string;
  email: string;
  name: string;
  contact_number: string | null;
  is_event_owner: boolean;
  is_programme_officer: boolean;
  is_active: number;
  must_change_password: number;
  mfa_enrolled: number;
  created_at: string;
};

function DesignationChecks({
  isEventOwner,
  isProgrammeOfficer,
  contact,
  onEventOwnerChange,
  onProgrammeOfficerChange,
  onContactChange,
}: {
  isEventOwner: boolean;
  isProgrammeOfficer: boolean;
  contact: string;
  onEventOwnerChange: (next: boolean) => void;
  onProgrammeOfficerChange: (next: boolean) => void;
  onContactChange: (next: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-ink-secondary etched">
          <input
            type="checkbox"
            checked={isEventOwner}
            onChange={(e) => onEventOwnerChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-ink-muted"
          />
          <span className="font-medium text-ink-primary">Event owner</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-secondary etched">
          <input
            type="checkbox"
            checked={isProgrammeOfficer}
            onChange={(e) => onProgrammeOfficerChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-ink-muted"
          />
          <span className="font-medium text-ink-primary">Also programme officer</span>
        </label>
      </div>
      {isProgrammeOfficer && (
        <input
          value={contact}
          onChange={(e) => onContactChange(e.target.value)}
          placeholder="Contact number (required)"
          className="carved w-full max-w-xs rounded-lg bg-marble-highlight/60 px-3 py-2 text-sm text-ink-primary focus:outline-none"
        />
      )}
    </div>
  );
}

function TeamAccountsSection() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newIsEventOwner, setNewIsEventOwner] = useState(true);
  const [newIsProgrammeOfficer, setNewIsProgrammeOfficer] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; temporaryPassword: string } | null>(null);
  const [editing, setEditing] = useState<Record<string, {
    name: string;
    email: string;
    contact_number: string;
    is_event_owner: boolean;
    is_programme_officer: boolean;
  }>>({});

  const { data, isLoading } = useQuery<{ users: TeamUser[] }>({
    queryKey: ["users"],
    queryFn: () => apiGet("/users"),
  });

  const create = useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      contact_number?: string | null;
      is_event_owner?: boolean;
      is_programme_officer?: boolean;
    }) =>
      // Permissions omitted — API applies the default event-manager set.
      apiPost<{ id: string; email: string; name: string; temporaryPassword: string }>("/users", input),
    onSuccess: (res) => {
      setCreated({ name: res.name, email: res.email, temporaryPassword: res.temporaryPassword });
      setNewName(""); setNewEmail(""); setNewContact("");
      setNewIsEventOwner(true); setNewIsProgrammeOfficer(false);
      setErr(null);
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
      qc.invalidateQueries({ queryKey: ["lookup", "program_officer"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: {
      name?: string;
      email?: string;
      contact_number?: string | null;
      is_event_owner?: boolean;
      is_programme_officer?: boolean;
    } }) =>
      apiPut(`/users/${id}`, patch),
    onSuccess: () => {
      setEditing({});
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
      qc.invalidateQueries({ queryKey: ["lookup", "program_officer"] });
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const reset = useMutation({
    mutationFn: async (id: string) =>
      apiPost<{ email: string; name: string; temporaryPassword: string }>(`/users/${id}/reset`),
    onSuccess: (res) => setCreated({ name: res.name, email: res.email, temporaryPassword: res.temporaryPassword }),
    onError: (e: Error) => setErr(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      apiPost(`/users/${id}/${active ? "activate" : "deactivate"}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
      qc.invalidateQueries({ queryKey: ["lookup", "program_officer"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const users = data?.users ?? [];
  const activeUsers = users.filter((u) => u.is_active);
  const deactivatedUsers = users.filter((u) => !u.is_active);
  const canCreate = Boolean(
    newName.trim()
    && newEmail.trim()
    && (!newIsProgrammeOfficer || newContact.trim()),
  );

  const renderUserRow = (u: TeamUser) => {
    const ed = editing[u.id];
    const isSelf = u.id === me?.id;
    return (
      <li key={u.id} className="rounded-xl bg-marble-shadow/30 px-4 py-3">
        {ed ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <input value={ed.name} onChange={(e) => setEditing((s) => ({ ...s, [u.id]: { ...ed, name: e.target.value } }))} className="carved min-w-0 flex-1 rounded-lg bg-marble-highlight/60 px-2 py-1 text-sm text-ink-primary focus:outline-none" />
              <input value={ed.email} onChange={(e) => setEditing((s) => ({ ...s, [u.id]: { ...ed, email: e.target.value } }))} className="carved min-w-0 flex-1 rounded-lg bg-marble-highlight/60 px-2 py-1 text-sm text-ink-primary focus:outline-none" />
              <button
                type="button"
                disabled={update.isPending || !ed.name.trim() || !ed.email.trim() || (ed.is_programme_officer && !ed.contact_number.trim())}
                onClick={() => update.mutate({
                  id: u.id,
                  patch: {
                    name: ed.name.trim(),
                    email: ed.email.trim(),
                    is_event_owner: ed.is_event_owner,
                    is_programme_officer: ed.is_programme_officer,
                    contact_number: ed.is_programme_officer ? (ed.contact_number.trim() || null) : null,
                  },
                })}
                className="text-xs font-semibold text-sage-text hover:underline disabled:opacity-40"
              >
                Save
              </button>
              <button type="button" onClick={() => setEditing((s) => { const n = { ...s }; delete n[u.id]; return n; })} className="text-xs text-ink-muted hover:underline">Cancel</button>
            </div>
            <DesignationChecks
              isEventOwner={ed.is_event_owner}
              isProgrammeOfficer={ed.is_programme_officer}
              contact={ed.contact_number}
              onEventOwnerChange={(next) => setEditing((s) => ({ ...s, [u.id]: { ...ed, is_event_owner: next } }))}
              onProgrammeOfficerChange={(next) => setEditing((s) => ({ ...s, [u.id]: { ...ed, is_programme_officer: next } }))}
              onContactChange={(next) => setEditing((s) => ({ ...s, [u.id]: { ...ed, contact_number: next } }))}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={"text-sm font-medium " + (u.is_active ? "text-ink-primary etched-deep" : "text-ink-muted line-through")}>{u.name}</span>
                {u.is_event_owner && <span className="rounded-full bg-terracotta-btn/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-terracotta-text">event owner</span>}
                {u.is_programme_officer && <span className="rounded-full bg-sage/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-text">also programme officer</span>}
                {u.is_programme_officer && u.contact_number && <span className="text-sm tabular-nums text-ink-secondary etched">{u.contact_number}</span>}
                {isSelf && <span className="rounded-full bg-sage/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-text">you</span>}
                {Boolean(u.must_change_password) && <span className="rounded-full bg-status-cancelled/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-cancelled">must reset</span>}
              </div>
              <div className="mt-0.5 truncate text-xs text-ink-muted etched">{u.email}</div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1">
              <button type="button" onClick={() => setEditing((s) => ({
                ...s,
                [u.id]: {
                  name: u.name,
                  email: u.email,
                  contact_number: u.contact_number ?? "",
                  is_event_owner: u.is_event_owner,
                  is_programme_officer: u.is_programme_officer,
                },
              }))} className="text-xs text-sage-text hover:underline">Edit</button>
              <button type="button" disabled={reset.isPending} onClick={() => { if (window.confirm(`Reset ${u.name}'s password? This signs them out everywhere.`)) reset.mutate(u.id); }} className="text-xs text-ink-secondary hover:underline">Reset password</button>
              {u.is_active ? (
                <button type="button" disabled={toggle.isPending || isSelf} onClick={() => toggle.mutate({ id: u.id, active: false })} className="text-xs text-ink-secondary hover:underline disabled:opacity-40">Deactivate</button>
              ) : (
                <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: u.id, active: true })} className="text-xs text-sage-text hover:underline">Activate</button>
              )}
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div>
      {err && <div role="alert" className="mb-3 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">{err}</div>}

      {created && (
        <div className="mb-4 rounded-xl bg-status-awaitingApproval/10 px-4 py-3">
          <p className="text-xs font-medium text-status-awaitingApproval etched">
            Temporary password for <strong>{created.name}</strong> ({created.email}) — shown once. Share it securely; they choose their own password on first sign-in.
          </p>
          <code className="mt-1 block rounded-lg bg-marble-shadow/40 px-3 py-2 font-mono text-sm text-ink-primary">
            {created.temporaryPassword}
          </code>
          <button type="button" onClick={() => setCreated(null)} className="carved-btn mt-2 rounded-full bg-neutral-btn px-4 py-1 text-xs font-medium text-ink-secondary etched">
            Done
          </button>
        </div>
      )}

      <div className="mb-5 rounded-xl bg-marble-shadow/30 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">New login</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className="carved rounded-lg bg-marble-highlight/60 px-3 py-2 text-sm text-ink-primary focus:outline-none" />
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="person@example.com" type="email" className="carved rounded-lg bg-marble-highlight/60 px-3 py-2 text-sm text-ink-primary focus:outline-none" />
          <button
            type="button"
            disabled={create.isPending || !canCreate}
            onClick={() => create.mutate({
              name: newName.trim(),
              email: newEmail.trim().toLowerCase(),
              contact_number: newIsProgrammeOfficer ? (newContact.trim() || null) : null,
              is_event_owner: newIsEventOwner,
              is_programme_officer: newIsProgrammeOfficer,
            })}
            className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-xs font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
          >
            {create.isPending ? "Creating…" : "+ Add"}
          </button>
        </div>
        <div className="mt-3 border-t border-ink-muted/10 pt-3">
          <DesignationChecks
            isEventOwner={newIsEventOwner}
            isProgrammeOfficer={newIsProgrammeOfficer}
            contact={newContact}
            onEventOwnerChange={setNewIsEventOwner}
            onProgrammeOfficerChange={setNewIsProgrammeOfficer}
            onContactChange={setNewContact}
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-muted etched">Loading…</p>
      ) : activeUsers.length === 0 && deactivatedUsers.length === 0 ? (
        <p className="text-sm text-ink-muted etched">No accounts yet.</p>
      ) : (
        <>
          {activeUsers.length === 0 ? (
            <p className="text-sm text-ink-muted etched">No active accounts.</p>
          ) : (
            <ul className="space-y-2">
              {activeUsers.map(renderUserRow)}
            </ul>
          )}

          {deactivatedUsers.length > 0 && (
            <div className="mt-4 border-t border-ink-muted/10 pt-3">
              <button
                type="button"
                onClick={() => setShowDeactivated((o) => !o)}
                aria-expanded={showDeactivated}
                className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted etched hover:text-ink-secondary"
              >
                <span>Deactivated ({deactivatedUsers.length})</span>
                <span aria-hidden="true">{showDeactivated ? "▴" : "▾"}</span>
              </button>
              {showDeactivated && (
                <ul className="mt-2 space-y-2">
                  {deactivatedUsers.map(renderUserRow)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
