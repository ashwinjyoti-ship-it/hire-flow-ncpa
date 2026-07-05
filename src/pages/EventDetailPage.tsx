import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, apiPost } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/use-lookups";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import { STATUS_LABELS, canTransition, requiresOverride } from "../../worker/lib/state-machine";
import type { EventStatus } from "../../worker/lib/state-machine";

type DetailResponse = {
  event: Record<string, unknown> & {
    id: string; title: string; status: EventStatus; event_type: string | null;
    event_start_date: string | null; event_end_date: string | null;
    organisation_name: string | null; event_owner: string | null;
    description: string | null; notes: string | null; approval_status: string | null;
    confirmation_status: string | null; overall_completion: number | null;
    ops_completion: number | null; accounts_completion: number | null;
  };
  venue_bookings: Array<Record<string, unknown> & { schedule_entries: unknown[] }>;
  activity: Array<Record<string, unknown>>;
};

type ConflictsResponse = {
  conflicts: Array<Record<string, unknown> & { level: string; venue: string; title: string; status: string; activity_date: string; activity_type: string }>;
};

const ACTIVITY_LABELS: Record<string, string> = {
  created: "Event created",
  updated: "Event updated",
  status_changed: "Status changed",
  venue_added: "Venue added",
  venue_removed: "Venue removed",
  confirmed: "Event confirmed",
  completed: "Event completed",
  closed: "Event closed",
  note_added: "Note added",
};

export function EventDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "venues" | "activity" | "conflicts">("overview");
  const [statusModal, setStatusModal] = useState<EventStatus | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["event", id],
    queryFn: () => apiGet<DetailResponse>(`/events/${id}`),
  });

  const { data: conflictsData } = useQuery({
    queryKey: ["event", id, "conflicts"],
    queryFn: () => apiGet<ConflictsResponse>(`/events/${id}/conflicts`),
  });

  const transition = useMutation({
    mutationFn: async (args: { to: EventStatus; reason: string }) =>
      apiPost(`/events/${id}/status`, { to_status: args.to, reason: args.reason }),
    onSuccess: () => {
      setStatusModal(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["event", id] });
    },
  });

  if (isLoading) return <div className="text-sm text-ink-muted">Loading…</div>;
  const e = data?.event;
  if (!e) return <div className="text-sm text-ink-muted">Event not found.</div>;

  const allowedTransitions = (Object.keys(STATUS_LABELS) as EventStatus[]).filter((s) => canTransition(e.status, s));
  const canChangeStatus = can(user?.role ?? "viewer", "event.status.change");

  return (
    <div>
      <PageHeader
        title={e.organisation_name ?? "—"}
        subtitle={e.title}
        actions={
          <>
            <StatusBadge status={e.status} size="md" />
            {can(user?.role ?? "viewer", "event.edit") && (
              <Link to={`/events/${id}/edit`} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
                Edit
              </Link>
            )}
            {canChangeStatus && (e.status === "confirmed" || e.status === "approved" || e.status === "tentative") && (
              <button
                type="button"
                onClick={() => { setStatusModal("cancelled"); setReason(""); }}
                className="carved-btn rounded-full bg-status-cancelled/15 px-4 py-2 text-sm font-semibold text-status-cancelled etched hover:bg-status-cancelled/25"
              >
                Cancel event
              </button>
            )}
            {canChangeStatus && (e.status === "enquiry" || e.status === "tentative" || e.status === "approved") && (
              <button
                type="button"
                onClick={() => { setStatusModal("regret"); setReason(""); }}
                className="carved-btn rounded-full bg-status-regret/15 px-4 py-2 text-sm font-semibold text-status-regret etched hover:bg-status-regret/25"
              >
                Mark as Regret
              </button>
            )}
          </>
        }
      />

      {/* Header summary */}
      <div className="carved-card mb-6 grid grid-cols-2 gap-4 rounded-2xl bg-marble-highlight/50 p-5 md:grid-cols-5">
        <SummaryItem label="Type" value={e.event_type ?? "—"} />
        <SummaryItem label="Dates" value={e.event_start_date ? `${formatDate(e.event_start_date)}${e.event_end_date && e.event_end_date !== e.event_start_date ? " → " + formatDate(e.event_end_date) : ""}` : "—"} />
        <SummaryItem label="Owner" value={e.event_owner ?? "—"} />
        <SummaryItem label="Approval" value={e.approval_status ?? "—"} />
        <SummaryItem label="Completion" value={e.overall_completion != null ? `${Math.round(e.overall_completion * 100)}%` : "—"} />
      </div>

      {/* VFH approval notice */}
      {e.event_type === "VFH" && e.approval_status && e.approval_status !== "received" && e.approval_status !== "approved" && (
        <div className="mb-4 rounded-lg bg-status-awaitingApproval/10 px-4 py-2 text-xs text-status-awaitingApproval etched">
          VFH event — approval {e.approval_status}. Confirmation requires approval to be received.
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-1">
        {([
          ["overview", "Overview"],
          ["venues", `Venues & Schedule${data?.venue_bookings.length ? ` (${data.venue_bookings.length})` : ""}`],
          ["conflicts", `Conflicts${conflictsData?.conflicts.length ? ` (${conflictsData.conflicts.length})` : ""}`],
          ["activity", "Activity"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "rounded-full px-4 py-1.5 text-sm font-medium etched " +
              (tab === key ? "bg-sage-btn text-sage-text carved-btn-sage" : "text-ink-secondary hover:bg-marble-shadow/40")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Description</h3>
            <p className="whitespace-pre-wrap text-sm text-ink-secondary etched">{e.description || e.notes || "No description provided."}</p>
          </section>
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Completion</h3>
            <div className="space-y-3">
              <ProgressBar label="Operations" value={e.ops_completion} />
              <ProgressBar label="Accounts" value={e.accounts_completion} />
              <ProgressBar label="Overall" value={e.overall_completion} emphasis />
            </div>
          </section>
        </div>
      )}

      {tab === "venues" && (
        <div className="space-y-4">
          {data?.venue_bookings.map((vb, idx) => (
            <section key={vb.id as string} className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-primary etched-deep">
                  <span className="text-sage">Venue {idx + 1}:</span> {vb.venue as string}
                </h3>
                <span className="text-[11px] uppercase tracking-wider text-ink-muted etched">{vb.booking_status as string}</span>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                <SummaryItem label="Shows" value={String(vb.number_of_shows ?? 1)} />
                <SummaryItem label="Booking" value={String(vb.booking_status ?? "—")} />
              </div>
              {vb.schedule_entries.length > 0 ? (
                <div className="rounded-lg bg-marble-shadow/30 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Schedule</div>
                  <div className="space-y-2">
                    {vb.schedule_entries.map((se) => {
                      const entry = se as {
                        id: string; activity_type: string; activity_date: string;
                        start_time: string | null; end_time: string | null;
                        with_ac_start: string | null; with_ac_end: string | null; with_ac_minutes: number | null;
                        without_ac_start: string | null; without_ac_end: string | null; without_ac_minutes: number | null;
                        notes: string | null;
                      };
                      return (
                        <div key={entry.id} className="rounded-md bg-marble-highlight/50 px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-secondary etched">
                            <span className="inline-block w-24 font-medium capitalize text-sage-text">{entry.activity_type.replace(/_/g, " ")}</span>
                            <span>{formatDate(entry.activity_date)}</span>
                            {entry.start_time && <span>{entry.start_time}{entry.end_time ? `–${entry.end_time}` : ""}</span>}
                            {entry.notes && <span className="text-ink-muted">· {entry.notes}</span>}
                          </div>
                          {(entry.with_ac_start || entry.without_ac_start) && (
                            <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-ink-muted etched">
                              {entry.with_ac_start && (
                                <span>With AC: {entry.with_ac_start}{entry.with_ac_end ? `–${entry.with_ac_end}` : ""}{entry.with_ac_minutes != null ? ` (${Math.floor(entry.with_ac_minutes / 60)}h ${entry.with_ac_minutes % 60}m)` : ""}</span>
                              )}
                              {entry.without_ac_start && (
                                <span>Without AC: {entry.without_ac_start}{entry.without_ac_end ? `–${entry.without_ac_end}` : ""}{entry.without_ac_minutes != null ? ` (${Math.floor(entry.without_ac_minutes / 60)}h ${entry.without_ac_minutes % 60}m)` : ""}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-ink-muted etched">No schedule entries.</p>
              )}
            </section>
          ))}
        </div>
      )}

      {tab === "conflicts" && (
        <div className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          {(conflictsData?.conflicts.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-muted etched">No venue conflicts detected.</p>
          ) : (
            <div className="space-y-2">
              {conflictsData?.conflicts.map((c, i) => (
                <div key={i} className={"rounded-lg px-3 py-2 text-sm " + (c.level === "conflict" ? "bg-status-cancelled/10 text-status-cancelled" : "bg-status-awaitingApproval/10 text-status-awaitingApproval")}>
                  <span className="font-medium uppercase">{c.level === "conflict" ? "Conflict" : "Potential conflict"}</span> with{" "}
                  <Link to={`/events/${String(c.event_id)}`} className="underline">{String(c.title)}</Link> ({c.venue}, {formatDate(c.activity_date)} · {c.activity_type}) — status {c.status}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
          <ol className="space-y-3">
            {data?.activity.map((a) => (
              <li key={a.id as string} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sage" />
                <div>
                  <span className="font-medium text-ink-primary etched-deep">{ACTIVITY_LABELS[a.activity_type as string] ?? String(a.activity_type)}</span>
                  {a.actor_name ? <span className="text-ink-muted"> · {a.actor_name as string}</span> : null}
                  <div className="text-[11px] text-ink-muted">{formatDateTime(a.created_at as string)}</div>
                </div>
              </li>
            ))}
            {(data?.activity.length ?? 0) === 0 && <li className="text-sm text-ink-muted etched">No activity yet.</li>}
          </ol>
        </div>
      )}

      {/* Status transition modal */}
      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-primary/20 backdrop-blur-sm" onClick={() => setStatusModal(null)}>
          <div className="carved-card w-full max-w-md rounded-2xl bg-marble-highlight p-6" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-2 text-sm font-semibold text-ink-primary etched-deep">Change status to {STATUS_LABELS[statusModal]}</h3>
            <p className="mb-4 text-xs text-ink-muted etched">
              {requiresOverride(e.status, statusModal) ? "This is an override and requires a reason." : statusModal === "cancelled" ? "Cancellation requires a reason." : "Optional note for this transition."}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason / note…"
              className="carved mb-4 w-full rounded-xl bg-marble-shadow/40 px-4 py-2.5 text-sm text-ink-primary focus:outline-none"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setStatusModal(null)} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">Cancel</button>
              <button
                type="button"
                disabled={transition.isPending || ((statusModal === "cancelled" || requiresOverride(e.status, statusModal)) && !reason.trim())}
                onClick={() => transition.mutate({ to: statusModal, reason })}
                className="carved-btn-sage rounded-full bg-sage-btn px-4 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
              >
                {transition.isPending ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status actions */}
      {canChangeStatus && allowedTransitions.length > 0 && (
        <div className="carved-card mt-6 flex flex-wrap gap-2 rounded-2xl bg-marble-highlight/50 p-4">
          <span className="self-center text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Change status:</span>
          {allowedTransitions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setStatusModal(s); setReason(""); }}
              className="rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-medium text-ink-secondary etched carved-btn hover:bg-marble-shadow/40"
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-muted etched">{label}</div>
      <div className="text-sm font-medium text-ink-primary etched-deep">{value}</div>
    </div>
  );
}

function ProgressBar({ label, value, emphasis }: { label: string; value: number | null; emphasis?: boolean }) {
  const pct = value != null ? Math.round(value * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className={emphasis ? "font-semibold text-ink-primary etched-deep" : "text-ink-secondary etched"}>{label}</span>
        <span className={emphasis ? "font-semibold text-sage-text etched" : "text-ink-muted etched"}>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-marble-shadow/60">
        <div className="h-full rounded-full bg-sage-btn" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
