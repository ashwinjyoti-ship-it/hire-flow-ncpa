import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { apiGet } from "../lib/api";

type OrgSummary = {
  id: string; name: string; org_type: string | null; primary_contact: string | null; event_count: number;
};
type OrgsResponse = { organisations: OrgSummary[] };

export function OrganisationsPage() {
  const [q, setQ] = useState("");
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  const { data, isLoading } = useQuery({
    queryKey: ["orgs", q],
    queryFn: () => apiGet<OrgsResponse>(`/organisations?${query.toString()}`),
  });

  return (
    <div>
      <PageHeader title="Organisations & Clients" subtitle={`${data?.organisations.length ?? 0} organisations`} />
      <div className="carved-card mb-6 rounded-2xl bg-marble-highlight/40 p-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search organisations…"
          className="carved w-full rounded-lg bg-marble-shadow/40 px-4 py-2 text-sm text-ink-primary focus:outline-none"
        />
      </div>

      {isLoading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : (data?.organisations.length ?? 0) === 0 ? (
        <div className="carved-card rounded-2xl bg-marble-highlight/40 p-8 text-center text-sm text-ink-muted etched">
          No organisations found.
        </div>
      ) : (
        <div className="carved-card overflow-hidden rounded-2xl bg-marble-highlight/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-muted/10 text-left text-[11px] uppercase tracking-wider text-ink-muted etched">
                <th className="px-4 py-3 font-semibold">Organisation</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Primary Contact</th>
                <th className="px-4 py-3 font-semibold">Events</th>
              </tr>
            </thead>
            <tbody>
              {data?.organisations.map((o) => (
                <tr key={o.id} className="border-b border-ink-muted/5 hover:bg-marble-shadow/20">
                  <td className="px-4 py-3 font-medium text-ink-primary etched-deep">{o.name}</td>
                  <td className="px-4 py-3 text-ink-secondary etched">{o.org_type ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-secondary etched">{o.primary_contact ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-secondary etched">
                    {o.event_count > 0 ? <Link to={`/events?org=${o.id}`} className="text-sage-text hover:underline">{o.event_count}</Link> : "0"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
