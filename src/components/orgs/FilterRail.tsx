/** Left filter rail for the Organisations page. Composes Type chips, event
 * buckets (the "range slider" expressed as 3 toggle chips for accessibility),
 * Last-activity chips, the Has-primary-contact toggle, and a Reset footer.
 *
 * Expects precomputed facet counts so we never recompute over the full dataset
 * inside each leaf component. */
import { FacetChip } from "./FacetChip";
import { Toggle } from "./Toggle";
import {
  EVENT_BUCKETS,
  ORG_TYPES,
  RECENCY_BUCKETS,
  RECENCY_LABELS,
  type Filters,
} from "./types";

export type FacetCounts = {
  types: Record<string, number>;
  eventBuckets: Record<string, number>;
  recency: Record<string, number>;
  hasPrimaryContact: number;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-sage etched">
      {children}
    </div>
  );
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function FilterRail({
  filters,
  counts,
  onChange,
  onReset,
}: {
  filters: Filters;
  counts: FacetCounts;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
}) {
  return (
    <div className="carved-card flex flex-col gap-5 rounded-2xl bg-marble-highlight/50 p-5">
      {/* Type */}
      <div>
        <SectionLabel>Type</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {ORG_TYPES.map((t) => (
            <FacetChip
              key={t}
              label={t}
              count={counts.types[t] ?? 0}
              active={filters.types.includes(t)}
              onClick={() => onChange({ types: toggleInList(filters.types, t) })}
            />
          ))}
        </div>
      </div>

      {/* Events — buckets expressed as chips (spec calls it a range slider; the
          bucket granularity is identical and far more a11y-friendly). */}
      <div>
        <SectionLabel>Events</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_BUCKETS.map((b) => (
            <FacetChip
              key={b}
              label={b}
              count={counts.eventBuckets[b] ?? 0}
              active={filters.eventBuckets.includes(b)}
              onClick={() => onChange({ eventBuckets: toggleInList(filters.eventBuckets, b) })}
            />
          ))}
        </div>
      </div>

      {/* Last activity */}
      <div>
        <SectionLabel>Last activity</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {RECENCY_BUCKETS.map((r) => (
            <FacetChip
              key={r}
              label={RECENCY_LABELS[r] ?? r}
              count={counts.recency[r] ?? 0}
              active={filters.recency.includes(r)}
              onClick={() => onChange({ recency: toggleInList(filters.recency, r) })}
            />
          ))}
        </div>
      </div>

      {/* Has primary contact? */}
      <div>
        <SectionLabel>Contact</SectionLabel>
        <Toggle
          checked={filters.hasPrimaryContact}
          onChange={(v) => onChange({ hasPrimaryContact: v })}
          label="Has primary contact?"
        />
        <div className="mt-0.5 text-[11px] text-ink-muted">{counts.hasPrimaryContact} organisations</div>
      </div>

      {/* Footer */}
      <div className="mt-auto border-t border-ink-muted/10 pt-3">
        <button
          type="button"
          onClick={onReset}
          className="carved-btn w-full rounded-full bg-neutral-btn px-4 py-2 text-xs font-medium text-ink-secondary etched hover:bg-neutral-btn-hover"
        >
          Reset filters
        </button>
      </div>
    </div>
  );
}
