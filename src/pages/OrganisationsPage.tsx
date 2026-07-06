import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { apiGet } from "../lib/api";
import { recencyBucket } from "../lib/dates";
import { ActiveFilterChips } from "../components/orgs/ActiveFilterChips";
import { FilterRail, type FacetCounts } from "../components/orgs/FilterRail";
import { OrgCard } from "../components/orgs/OrgCard";
import { ReengagementBanner } from "../components/orgs/ReengagementBanner";
import { ToastRegion, useToast } from "../components/orgs/Toast";
import {
  EMPTY_FILTERS,
  EVENT_BUCKETS,
  ORG_TYPES,
  type Filters,
  type OrgsResponse,
} from "../components/orgs/types";

function bucketMatches(count: number, bucket: string): boolean {
  if (bucket === "1-3") return count >= 1 && count <= 3;
  if (bucket === "4-9") return count >= 4 && count <= 9;
  if (bucket === "10+") return count >= 10;
  return false;
}

export function OrganisationsPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showAll, setShowAll] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { toast, show } = useToast();

  // Server handles the text search; faceting is client-side over the ~109 rows.
  const { data, isLoading } = useQuery({
    queryKey: ["orgs", filters.q],
    queryFn: () => apiGet<OrgsResponse>(`/organisations${filters.q ? `?q=${encodeURIComponent(filters.q)}` : ""}`),
  });
  const orgs = data?.organisations ?? [];
  const total = data?.total ?? orgs.length;

  // Facet counts computed once per dataset (ignore active filters so the rail
  // shows stable totals, the way the spec's example "(87)" implies).
  const counts: FacetCounts = useMemo(() => {
    const c: FacetCounts = { types: {}, eventBuckets: {}, recency: {}, hasPrimaryContact: 0 };
    for (const o of orgs) {
      if (o.org_type) {
        const t = ORG_TYPES.find((x) => x.toLowerCase() === o.org_type!.toLowerCase());
        if (t) c.types[t] = (c.types[t] ?? 0) + 1;
      }
      for (const b of EVENT_BUCKETS) if (bucketMatches(o.event_count, b)) c.eventBuckets[b] = (c.eventBuckets[b] ?? 0) + 1;
      const r = recencyBucket(o.last_activity_at);
      if (r) c.recency[r] = (c.recency[r] ?? 0) + 1;
      if (o.primary_contact_name) c.hasPrimaryContact += 1;
    }
    return c;
  }, [orgs]);

  // Apply all active facets.
  const filtered = useMemo(() => {
    const f = filters;
    return orgs.filter((o) => {
      if (f.types.length) {
        const t = o.org_type ? ORG_TYPES.find((x) => x.toLowerCase() === o.org_type!.toLowerCase()) : undefined;
        if (!t || !f.types.includes(t)) return false;
      }
      if (f.eventBuckets.length) {
        if (!f.eventBuckets.some((b) => bucketMatches(o.event_count, b))) return false;
      }
      if (f.recency.length) {
        const r = recencyBucket(o.last_activity_at);
        if (!r || !f.recency.includes(r)) return false;
      }
      if (f.hasPrimaryContact && !o.primary_contact_name) return false;
      return true;
    });
  }, [orgs, filters]);

  const anyFilterActive =
    filters.types.length > 0 ||
    filters.eventBuckets.length > 0 ||
    filters.recency.length > 0 ||
    filters.hasPrimaryContact ||
    !!filters.q;

  function patchFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setShowAll(false); // any filter change leaves the "browse all" bypass
  }
  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setShowAll(false);
  }

  // "See all N matches" from the banner: there's no freeform date-range facet,
  // so we surface the count via a transient toast and apply the closest recency
  // chip (last-year activity falls in the "inactive 6+ months" bucket by design).
  function seeAllMatches() {
    setFilters({ ...EMPTY_FILTERS, recency: ["inactive6"] });
    setShowAll(false);
    show("Filtered to organisations inactive 6+ months — last year's matches.");
  }

  const popularFacets: { label: string; patch: Partial<Filters>; count: number }[] = [
    { label: "Has primary contact", patch: { hasPrimaryContact: true }, count: counts.hasPrimaryContact },
    { label: "10+ events", patch: { eventBuckets: ["10+"] }, count: counts.eventBuckets["10+"] ?? 0 },
    { label: "Inactive 6+ months", patch: { recency: ["inactive6"] }, count: counts.recency.inactive6 ?? 0 },
  ];

  const rail = (
    <FilterRail filters={filters} counts={counts} onChange={patchFilters} onReset={resetFilters} />
  );

  return (
    <div>
      <PageHeader
        title="Organisations & Clients"
        subtitle={`${total} organisations`}
        actions={
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={filters.q}
              onChange={(e) => patchFilters({ q: e.target.value })}
              placeholder="Search organisations, contacts, events…"
              className="carved w-64 rounded-full bg-marble-shadow/40 px-4 py-2 text-sm text-ink-primary focus:outline-none"
            />
            <button
              type="button"
              onClick={() => show("Organisation creation isn't available yet.")}
              className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched hover:bg-sage-btn-hover"
            >
              + Add organisation
            </button>
          </div>
        }
      />

      {/* Re-engagement banner — always on top, derives its own matches. */}
      <ReengagementBanner orgs={orgs} onSeeAll={seeAllMatches} onToast={show} />

      {/* Mobile filter trigger (below the bp:900px breakpoint). */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="carved-btn mb-4 rounded-full bg-neutral-btn px-4 py-2 text-xs font-medium text-ink-secondary etched hover:bg-neutral-btn-hover bp:hidden"
      >
        Filters
      </button>

      {/* Faceted panel: rail + results. */}
      <div className="flex gap-6">
        <aside className="hidden bp:block bp:w-72 bp:shrink-0">{rail}</aside>

        <section className="min-w-0 flex-1">
          {/* Default state: nothing asked for yet. */}
          {!anyFilterActive && !showAll && (
            <div className="carved-card rounded-2xl bg-marble-highlight/50 p-8 text-center">
              <h3 className="text-sm font-semibold text-ink-primary etched-deep">Start with a popular filter</h3>
              <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted etched">
                Results stay hidden until you pick a filter — keeps the focus on what's actionable.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {popularFacets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => patchFilters(p.patch)}
                    className="carved-btn rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-medium text-ink-secondary etched hover:bg-neutral-btn-hover"
                  >
                    {p.label} <span className="text-ink-muted">({p.count})</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mt-5 text-xs font-medium text-sage-text hover:underline etched"
              >
                Browse all {total} organisations →
              </button>
            </div>
          )}

          {/* Filtered / browse-all state. */}
          {(anyFilterActive || showAll) && (
            <>
              <ActiveFilterChips filters={filters} onRemove={patchFilters} onClearAll={resetFilters} />
              {isLoading ? (
                <div className="text-sm text-ink-muted etched">Loading…</div>
              ) : filtered.length === 0 ? (
                <EmptyResults filters={filters} onSoften={patchFilters} />
              ) : (
                <>
                  <div className="mb-3 text-xs text-ink-muted etched">
                    {filtered.length} of {total} organisations
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((o) => (
                      <OrgCard key={o.id} org={o} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {/* Filter drawer (<900px). Clones the CalendarPage side-panel overlay. */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-ink-primary/20 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            className="scroll-slim carved-card h-full w-full max-w-xs overflow-y-auto rounded-r-2xl bg-marble-highlight p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-primary etched-deep">Filters</h3>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-ink-muted hover:text-ink-secondary"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {rail}
          </aside>
        </div>
      )}

      <ToastRegion toast={toast} />
    </div>
  );
}

/** Gentle, specific nudge when a filter combination yields nothing. Names the
 * narrowest facet so the user can widen exactly that one. */
function EmptyResults({
  filters,
  onSoften,
}: {
  filters: Filters;
  onSoften: (patch: Partial<Filters>) => void;
}) {
  // Compose a hint that references the most restrictive active facet.
  let hint = "Try widening your filters.";
  let softenPatch: Partial<Filters> | null = null;
  if (filters.eventBuckets.length) {
    const b = filters.eventBuckets[filters.eventBuckets.length - 1];
    hint = `No ${filters.types.join("/") || "organisation"} with ${b} events. Try widening "Events".`;
    softenPatch = { eventBuckets: filters.eventBuckets.slice(0, -1) };
  } else if (filters.recency.length) {
    hint = `No ${filters.types.join("/") || "organisation"} active in that window. Try a broader "Last activity".`;
    softenPatch = { recency: filters.recency.slice(0, -1) };
  } else if (filters.types.length) {
    hint = `No ${filters.types.join("/")} organisation matches the other filters.`;
    softenPatch = { types: filters.types.slice(0, -1) };
  }

  return (
    <div className="carved-card rounded-2xl bg-marble-highlight/50 p-8 text-center">
      <p className="text-sm text-ink-secondary etched">No matches.</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted etched">{hint}</p>
      {softenPatch && (
        <button
          type="button"
          onClick={() => onSoften(softenPatch!)}
          className="carved-btn mt-4 rounded-full bg-neutral-btn px-4 py-1.5 text-xs font-medium text-ink-secondary etched hover:bg-neutral-btn-hover"
        >
          Widen
        </button>
      )}
    </div>
  );
}
