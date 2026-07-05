import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, type EventSummary } from "../lib/api";
import { useLookups, formatDate } from "../lib/use-lookups";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";
import type { EventStatus } from "../../worker/lib/state-machine";

type EventsResponse = { events: EventSummary[] };

export function EventsListPage() {
  const { user } = useAuth();
  const { data: lookups } = useLookups();
  const [filters, setFilters] = useState({ status: "", venue: "", type: "", owner: "", q: "" });

  const query = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) query.set(k, v); });
  const { data, isLoading } = useQuery({
    queryKey: ["events", filters],
    queryFn: () => apiGet<EventsResponse>(`/events?${query.toString()}`),
  });

  const venues = lookups?.lookups.venue ?? [];
  const statuses: EventStatus[] = ["inquiry", "availability_check", "awaiting_approval", "waitlisted", "tentative", "approved", "confirmed", "in_progress", "completed", "closed", "cancelled", "rejected"];

  return (
    <div>
      <PageHeader
        title="Events"
        subtitle={`${data?.events.length ?? 0} events`}
        actions={
          can(user?.role ?? "viewer", "event.create") ? (
            <Link to="/events/new" className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched">
              + New Event
            </Link>
          ) : null
        }
      />

      {/* Filters */}
      <div className="carved-card mb-6 rounded-2xl bg-marble-highlight/40 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <FilterInput label="Search" value={filters.q} onChange={(v) => setFilters((f) => ({ ...f, q: v }))} placeholder="Title, org, code…" />
          <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} options={[{ value: "", label: "All" }, ...statuses.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))]} />
          <FilterSelect label="Venue" value={filters.venue} onChange={(v) => setFilters((f) => ({ ...f, venue: v }))} options={[{ value: "", label: "All" }, ...venues.map((v) => ({ value: v.value, label: v.value }))]} />
          <FilterSelect label="Type" value={filters.type} onChange={(v) => setFilters((f) => ({ ...f, type: v }))} options={[{ value: "", label: "All" }, { value: "EE", label: "EE" }, { value: "FR", label: "FR" }, { value: "VFH", label: "VFH" }, { value: "Free Event", label: "Free Event" }]} />
          <FilterSelect label="Owner" value={filters.owner} onChange={(v) => setFilters((f) => ({ ...f, owner: v }))} options={[{ value: "", label: "All" }, ...(lookups?.lookups.handled_by ?? []).map((o) => ({ value: o.value, label: o.value }))]} />
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : (data?.events.length ?? 0) === 0 ? (
        <div className="carved-card rounded-2xl bg-marble-highlight/40 p-8 text-center text-sm text-ink-muted etched">
          No events match these filters.
        </div>
      ) : (
        <div className="carved-card overflow-hidden rounded-2xl bg-marble-highlight/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-muted/10 text-left text-[11px] uppercase tracking-wider text-ink-muted etched">
                <th className="px-4 py-3 font-semibold">Event</th>
                <th className="px-4 py-3 font-semibold">Organisation</th>
                <th className="px-4 py-3 font-semibold">Venues</th>
                <th className="px-4 py-3 font-semibold">Dates</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Owner</th>
              </tr>
            </thead>
            <tbody>
              {data?.events.map((e) => (
                <tr key={e.id} className="border-b border-ink-muted/5 transition-colors hover:bg-marble-shadow/20">
                  <td className="px-4 py-3">
                    <Link to={`/events/${e.id}`} className="font-medium text-ink-primary etched-deep hover:text-sage-text">
                      {e.title}
                    </Link>
                    {e.event_code && <div className="text-[11px] text-ink-muted">{e.event_code}</div>}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary etched">{e.organisation_name ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-secondary etched">{e.venues ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-secondary etched">
                    {e.event_start_date ? formatDate(e.event_start_date) : "—"}
                    {e.event_end_date && e.event_end_date !== e.event_start_date ? ` → ${formatDate(e.event_end_date)}` : ""}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={e.status as EventStatus} /></td>
                  <td className="px-4 py-3 text-ink-secondary etched">{e.event_owner ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-sage etched">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="carved w-full rounded-lg bg-marble-shadow/40 px-3 py-1.5 text-sm text-ink-primary focus:outline-none"
      />
    </label>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-sage etched">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="carved w-full rounded-lg bg-marble-shadow/40 px-3 py-1.5 text-sm text-ink-primary focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
