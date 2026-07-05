import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../lib/auth";
import { apiGet, apiPost, apiPut, apiDelete } from "../lib/api";

type Settings = {
  resend: { configured: boolean; keyHint: string | null; source: string };
  mailFrom: string;
};

async function fetchSettings(): Promise<Settings> {
  const res = await fetch("/api/settings", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load settings");
  return (await res.json()) as Settings;
}

export function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [apiKey, setApiKey] = useState("");
  const [mailFrom, setMailFrom] = useState("");
  const [testEmail, setTestEmail] = useState(user?.email ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const isAdmin = user?.role === "admin";

  return (
    <div>
      <PageHeader title="Settings" subtitle="Application configuration (admin)" />

      {isAdmin && <MasterListsSection listKeys={["caterer", "decorator"]} />}

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
        <div className="grid gap-6 md:grid-cols-2">
          {/* Resend / email configuration */}
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Email — Resend</h2>
              <ConfiguredBadge configured={data?.resend.configured ?? false} />
            </div>
            <p className="mb-4 text-xs text-ink-muted etched">
              Email notifications use Resend. Until a key is configured, email sending gracefully no-ops (logged); in-app notifications work regardless.
            </p>
            {data?.resend.configured && (
              <p className="mb-4 text-xs text-ink-secondary etched">
                Current key: <code className="rounded bg-marble-shadow/60 px-1.5 py-0.5 font-mono text-[11px]">{data.resend.keyHint}</code>{" "}
                <span className="text-ink-muted">(source: {data.resend.source})</span>
              </p>
            )}

            {isAdmin ? (
              <>
                <label className="mb-4 block">
                  <span className="mb-1.5 block text-xs font-semibold text-sage etched">Resend API key</span>
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
                    className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
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

                <div className="mt-6 border-t border-ink-muted/10 pt-4">
                  <span className="mb-1.5 block text-xs font-semibold text-sage etched">Send a test email</span>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      className="carved flex-1 rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                      placeholder="you@example.com"
                    />
                    <button
                      type="button"
                      disabled={sendTest.isPending || !data?.resend.configured || !testEmail}
                      onClick={() => sendTest.mutate(testEmail)}
                      className="carved-btn rounded-full bg-neutral-btn px-5 py-2 text-sm font-medium text-ink-secondary etched disabled:opacity-60"
                    >
                      {sendTest.isPending ? "Sending…" : "Send test"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-muted etched">Only admins can configure the Resend key.</p>
            )}
          </section>

          {/* Mail-from address */}
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sage etched">From Address</h2>
            <p className="mb-4 text-xs text-ink-muted etched">The sender address for outgoing notifications. Use a verified domain in Resend.</p>
            {isAdmin ? (
              <>
                <label className="mb-4 block">
                  <span className="mb-1.5 block text-xs font-semibold text-sage etched">From</span>
                  <input
                    type="text"
                    value={mailFrom || (data?.mailFrom ?? "")}
                    onChange={(e) => setMailFrom(e.target.value)}
                    placeholder="NCPA Venue Hire <noreply@example.com>"
                    className="carved w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={saveMailFrom.isPending || !mailFrom}
                  onClick={() => saveMailFrom.mutate(mailFrom)}
                  className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
                >
                  {saveMailFrom.isPending ? "Saving…" : "Save from address"}
                </button>
              </>
            ) : (
              <p className="text-sm text-ink-secondary etched">{data?.mailFrom ?? "—"}</p>
            )}
          </section>
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

// ---- Master Lists section: admin CRUD for caterer / decorator dropdowns ----
type LookupOption = {
  id: string;
  value: string;
  sort_order: number;
  is_active: number;
};

function MasterListsSection({ listKeys }: { listKeys: string[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Record<string, { id: string; value: string } | null>>({});
  const [newVal, setNewVal] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  return (
    <section className="carved-card mb-6 rounded-2xl bg-marble-highlight/50 p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Master Lists</h2>
      <p className="mb-4 text-xs text-ink-muted etched">
        Manage the Caterer and Decorator option lists used in the Add Event form. Deactivating soft-deletes
        the option (existing events keep their value).
      </p>
      {err && <div role="alert" className="mb-3 rounded-lg bg-status-cancelled/10 px-3 py-1.5 text-xs text-status-cancelled">{err}</div>}
      <div className="grid gap-6 md:grid-cols-2">
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
    </section>
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
  const title = listKey[0]!.toUpperCase() + listKey.slice(1);

  return (
    <div className="rounded-xl bg-marble-shadow/30 p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink-primary etched-deep">{title}</h3>
      {isLoading ? <p className="text-xs text-ink-muted etched">Loading…</p> : (
        <ul className="mb-3 space-y-1.5">
          {options.length === 0 && <li className="text-xs text-ink-muted etched">No options yet.</li>}
          {options.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              {editingId === o.id ? (
                <>
                  <input value={editingValue} onChange={(e) => onEditChange(o.id, e.target.value)} className="carved flex-1 rounded-lg bg-marble-highlight/60 px-2 py-1 text-sm text-ink-primary focus:outline-none" />
                  <button type="button" disabled={update.isPending} onClick={() => update.mutate({ id: o.id, value: editingValue.trim() })} className="text-xs text-sage-text hover:underline">Save</button>
                  <button type="button" onClick={() => onEditChange(null, "")} className="text-xs text-ink-muted hover:underline">Cancel</button>
                </>
              ) : (
                <>
                  <span className={"flex-1 text-sm " + (o.is_active ? "text-ink-primary etched-deep" : "text-ink-muted line-through")}>{o.value}</span>
                  <button type="button" onClick={() => onEditChange(o.id, o.value)} className="text-xs text-sage-text hover:underline">Edit</button>
                  <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: o.id, active: !o.is_active })} className="text-xs text-ink-secondary hover:underline">{o.is_active ? "Deactivate" : "Activate"}</button>
                  <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(o.id)} className="text-xs text-status-cancelled hover:underline">Delete</button>
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
