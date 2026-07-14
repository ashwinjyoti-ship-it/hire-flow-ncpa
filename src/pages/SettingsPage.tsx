import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import { apiGet, apiPost, apiPut, apiDelete } from "../lib/api";
import { describeAccess, PERMISSION_GROUPS, PERMISSION_PRESETS, type Permission } from "../../worker/lib/rbac";

type Settings = {
  resend: { configured: boolean; keyHint: string | null; source: string };
  mailFrom: string;
  checklistIntervals: ChecklistIntervals;
  checklistIntervalMeta: ChecklistIntervalMeta[];
  checklistIntervalDefaults: ChecklistIntervals;
};

type ChecklistIntervals = {
  approval_followup: number;
  instalment: number;
  confirmation_letter: number;
  onstage: number;
  technical_meeting: number;
  feedback: number;
  accounts_file: number;
  send_file_to_accounts: number;
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
  send_file_to_accounts: 1,
};

const DEFAULT_CHECKLIST_INTERVAL_META: ChecklistIntervalMeta[] = [
  { key: "approval_followup", label: "Approval follow-up", description: "Days after Approval Sent On before the follow-up task is due." },
  { key: "instalment", label: "Installment follow-up", description: "Days after each installment expected date (0 = due on that date)." },
  { key: "confirmation_letter", label: "Confirmation letter follow-up", description: "Days after Confirmation Letter is couriered." },
  { key: "onstage", label: "OnStage follow-up", description: "Days after OnStage is asked of the client." },
  { key: "technical_meeting", label: "Technical meeting", description: "Days after the technical meeting date (0 = due on that date)." },
  { key: "feedback", label: "Feedback follow-up", description: "Days after the feedback form is sent." },
  { key: "accounts_file", label: "Accounts file follow-up", description: "Days after File Sent to Accounts before follow-up is due." },
  { key: "send_file_to_accounts", label: "Send file to accounts", description: "Days after the final show date to create the Send file to accounts task." },
];

async function fetchSettings(): Promise<Settings> {
  const res = await fetch("/api/settings", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load settings");
  return (await res.json()) as Settings;
}

/**
 * Collapsible settings panel. Header doubles as a toggle button with a rotating
 * chevron. Auto-opens when the URL hash matches `id` (so deep links like
 * /settings#event-owners from UserManagementPage still land on an open panel).
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
  const hashMatches = id && typeof window !== "undefined" && window.location.hash === `#${id}`;
  const [open, setOpen] = useState(defaultOpen || Boolean(hashMatches));

  // Respect a deep link that arrives after first paint (e.g. client-side nav).
  useEffect(() => {
    if (!id) return;
    if (window.location.hash === `#${id}`) setOpen(true);
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
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [apiKey, setApiKey] = useState("");
  const [mailFrom, setMailFrom] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState("");
  const [tempPassword, setTempPassword] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.mailFrom) setMailFrom(data.mailFrom);
  }, [data?.mailFrom]);

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
          {/* Resend / email configuration */}
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-ink-muted/10 pb-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Email Configuration</h2>
                <p className="mt-1 text-xs text-ink-muted etched">
                  Configure the notification sender, Resend API key, and an optional test message.
                </p>
              </div>
              <ConfiguredBadge configured={data?.resend.configured ?? false} />
            </div>

            {isAdmin ? (
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
              id="event-owners"
              title="Event Owners (Accounts)"
              description="Each event owner is a login. Add a contact number and tick Programme officer when they should appear on the event form. Adding one generates a one-time temporary password — share it with the owner securely. They will be prompted to choose their own password on first sign-in."
              defaultOpen
            >
              <EventOwnersSection />
            </CollapsibleSection>
          )}

          {isAdmin && (
            <CollapsibleSection
              title="Master Lists"
              description="Manage the Event Owner, Caterer, and Decorator option lists used in the Add Event form. Deactivating soft-deletes the option (existing events keep their value)."
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
};

const LIST_LABELS: Record<string, string> = {
  handled_by: "Event Owners",
  caterer: "Caterers",
  decorator: "Decorators",
};

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
// Each team member is a real login with an explicit permission list — there
// are no roles. Adding a person here creates both a users row (with a
// one-time temporary password) and a handled_by dropdown option, so they
// appear in the Event Owner dropdown AND can sign in. Presets are just
// tick-box shortcuts; every account stores its own list.
type OwnerUser = {
  id: string;
  email: string;
  name: string;
  permissions: Permission[];
  organisation: string | null;
  contact_number: string | null;
  is_programme_officer: boolean;
  is_active: number;
  must_change_password: number;
  mfa_enrolled: number;
  created_at: string;
};

const DEFAULT_NEW_PERMISSIONS = PERMISSION_PRESETS.find((p) => p.label === "Event manager")?.permissions ?? [];

/** Preset shortcut buttons + grouped permission checkboxes. */
function PermissionEditor({ value, onChange }: { value: Permission[]; onChange: (next: Permission[]) => void }) {
  const set = new Set(value);
  const toggle = (key: Permission) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  };
  return (
    <div className="rounded-xl bg-marble-highlight/60 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Presets:</span>
        {PERMISSION_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange([...preset.permissions])}
            className={
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium etched " +
              (describeAccess(value) === preset.label ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta" : "bg-marble-shadow/50 text-ink-secondary hover:bg-marble-shadow/70")
            }
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.group}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sage etched">{group.group}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <label key={item.key} className="flex items-center gap-2 text-xs text-ink-secondary etched">
                  <input
                    type="checkbox"
                    checked={set.has(item.key)}
                    onChange={() => toggle(item.key)}
                    className="h-3.5 w-3.5 rounded border-ink-muted"
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventOwnersSection() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newIsProgrammeOfficer, setNewIsProgrammeOfficer] = useState(false);
  const [newPermissions, setNewPermissions] = useState<Permission[]>([...DEFAULT_NEW_PERMISSIONS]);
  const [showNewPermissions, setShowNewPermissions] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; temporaryPassword: string } | null>(null);
  const [editing, setEditing] = useState<Record<string, {
    name: string;
    email: string;
    contact_number: string;
    is_programme_officer: boolean;
    permissions: Permission[];
  }>>({});

  const { data, isLoading } = useQuery<{ users: OwnerUser[] }>({
    queryKey: ["users"],
    queryFn: () => apiGet("/users"),
  });

  const create = useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      contact_number?: string | null;
      is_programme_officer?: boolean;
      permissions: Permission[];
    }) =>
      apiPost<{ id: string; email: string; name: string; temporaryPassword: string }>("/users", input),
    onSuccess: (res) => {
      setCreated({ name: res.name, email: res.email, temporaryPassword: res.temporaryPassword });
      setNewName(""); setNewEmail(""); setNewContact(""); setNewIsProgrammeOfficer(false);
      setNewPermissions([...DEFAULT_NEW_PERMISSIONS]); setShowNewPermissions(false);
      setErr(null);
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: {
      name?: string;
      email?: string;
      contact_number?: string | null;
      is_programme_officer?: boolean;
      permissions?: Permission[];
    } }) =>
      apiPut(`/users/${id}`, patch),
    onSuccess: () => {
      setEditing({});
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
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
    },
    onError: (e: Error) => setErr(e.message),
  });

  const users = data?.users ?? [];

  return (
    <div>
      {err && <div role="alert" className="mb-3 rounded-lg bg-status-cancelled/10 px-3 py-2 text-xs text-status-cancelled">{err}</div>}

      {created && (
        <div className="mb-4 rounded-xl bg-status-awaitingApproval/10 px-4 py-3">
          <p className="text-xs font-medium text-status-awaitingApproval etched">
            ⚠ Temporary password for <strong>{created.name}</strong> ({created.email}) — shown once:
          </p>
          <code className="mt-1 block rounded-lg bg-marble-shadow/40 px-3 py-2 font-mono text-sm text-ink-primary">
            {created.temporaryPassword}
          </code>
          <button type="button" onClick={() => setCreated(null)} className="carved-btn mt-2 rounded-full bg-neutral-btn px-4 py-1 text-xs font-medium text-ink-secondary etched">
            Done
          </button>
        </div>
      )}

      {/* Add team member */}
      <div className="mb-5 rounded-xl bg-marble-shadow/30 p-3">
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto_auto]">
          <input value={newContact} onChange={(e) => setNewContact(e.target.value)} placeholder="Contact no." className="carved rounded-lg bg-marble-highlight/60 px-3 py-2 text-sm text-ink-primary focus:outline-none" />
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className="carved rounded-lg bg-marble-highlight/60 px-3 py-2 text-sm text-ink-primary focus:outline-none" />
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="person@example.com" type="email" className="carved rounded-lg bg-marble-highlight/60 px-3 py-2 text-sm text-ink-primary focus:outline-none" />
          <button
            type="button"
            onClick={() => setShowNewPermissions((v) => !v)}
            className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-xs font-medium text-ink-secondary etched"
          >
            {describeAccess(newPermissions)} {showNewPermissions ? "▴" : "▾"}
          </button>
          <button
            type="button"
            disabled={create.isPending || !newName.trim() || !newEmail.trim() || newPermissions.length === 0}
            onClick={() => create.mutate({
              name: newName.trim(),
              email: newEmail.trim().toLowerCase(),
              contact_number: newContact.trim() || null,
              is_programme_officer: newIsProgrammeOfficer,
              permissions: newPermissions,
            })}
            className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-xs font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
          >
            {create.isPending ? "Creating…" : "+ Add person"}
          </button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-secondary etched">
          <input
            type="checkbox"
            checked={newIsProgrammeOfficer}
            onChange={(e) => setNewIsProgrammeOfficer(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-ink-muted"
          />
          Programme officer?
        </label>
        {showNewPermissions && (
          <div className="mt-2">
            <PermissionEditor value={newPermissions} onChange={setNewPermissions} />
          </div>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-ink-muted etched">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-ink-muted etched">No accounts yet.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => {
            const ed = editing[u.id];
            const isSelf = u.id === me?.id;
            return (
              <li key={u.id} className="rounded-xl bg-marble-shadow/30 px-4 py-3">
                {ed ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <input value={ed.contact_number} onChange={(e) => setEditing((s) => ({ ...s, [u.id]: { ...ed, contact_number: e.target.value } }))} placeholder="Contact no." className="carved w-36 rounded-lg bg-marble-highlight/60 px-2 py-1 text-sm text-ink-primary focus:outline-none" />
                      <input value={ed.name} onChange={(e) => setEditing((s) => ({ ...s, [u.id]: { ...ed, name: e.target.value } }))} className="carved min-w-0 flex-1 rounded-lg bg-marble-highlight/60 px-2 py-1 text-sm text-ink-primary focus:outline-none" />
                      <input value={ed.email} onChange={(e) => setEditing((s) => ({ ...s, [u.id]: { ...ed, email: e.target.value } }))} className="carved min-w-0 flex-1 rounded-lg bg-marble-highlight/60 px-2 py-1 text-sm text-ink-primary focus:outline-none" />
                      <button type="button" disabled={update.isPending || ed.permissions.length === 0} onClick={() => update.mutate({ id: u.id, patch: { ...ed, contact_number: ed.contact_number.trim() || null } })} className="text-xs font-semibold text-sage-text hover:underline disabled:opacity-40">Save</button>
                      <button type="button" onClick={() => setEditing((s) => { const n = { ...s }; delete n[u.id]; return n; })} className="text-xs text-ink-muted hover:underline">Cancel</button>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-ink-secondary etched">
                      <input
                        type="checkbox"
                        checked={ed.is_programme_officer}
                        onChange={(e) => setEditing((s) => ({ ...s, [u.id]: { ...ed, is_programme_officer: e.target.checked } }))}
                        className="h-3.5 w-3.5 rounded border-ink-muted"
                      />
                      Programme officer?
                    </label>
                    <PermissionEditor value={ed.permissions} onChange={(next) => setEditing((s) => ({ ...s, [u.id]: { ...ed, permissions: next } }))} />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {u.contact_number && <span className="text-sm tabular-nums text-ink-secondary etched">{u.contact_number}</span>}
                        <span className={"text-sm font-medium " + (u.is_active ? "text-ink-primary etched-deep" : "text-ink-muted line-through")}>{u.name}</span>
                        {u.is_programme_officer && <span className="rounded-full bg-sage/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-text">programme officer</span>}
                        {isSelf && <span className="rounded-full bg-sage/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-text">you</span>}
                        {u.permissions.includes("user.manage") && <span className="rounded-full bg-status-awaitingApproval/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-awaitingApproval">manages accounts</span>}
                        {Boolean(u.must_change_password) && <span className="rounded-full bg-status-cancelled/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-cancelled">must reset</span>}
                        {Boolean(u.mfa_enrolled) && <span className="rounded-full bg-sage/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage-text">MFA</span>}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-muted etched">{u.email} · {describeAccess(u.permissions)}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1">
                      <button type="button" onClick={() => setEditing((s) => ({
                        ...s,
                        [u.id]: {
                          name: u.name,
                          email: u.email,
                          contact_number: u.contact_number ?? "",
                          is_programme_officer: u.is_programme_officer,
                          permissions: [...u.permissions],
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
          })}
        </ul>
      )}
    </div>
  );
}
