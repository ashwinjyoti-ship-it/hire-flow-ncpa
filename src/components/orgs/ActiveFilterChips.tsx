/** The row of removable chips shown above results when filters are active.
 * Each chip clears one facet value; the trailing "Clear all" resets everything. */
import { FacetChip } from "./FacetChip";
import { EVENT_BUCKETS, RECENCY_LABELS, type Filters } from "./types";

const EVENT_LABELS: Record<string, string> = {
  "1-3": "1–3 events",
  "4-9": "4–9 events",
  "10+": "10+ events",
};

export function ActiveFilterChips({
  filters,
  onRemove,
  onClearAll,
}: {
  filters: Filters;
  onRemove: (patch: Partial<Filters>) => void;
  onClearAll: () => void;
}) {
  const chips: { key: string; label: string; patch: Partial<Filters> }[] = [];

  if (filters.q) chips.push({ key: "q", label: `“${filters.q}”`, patch: { q: "" } });
  for (const t of filters.types)
    chips.push({ key: `t-${t}`, label: t, patch: { types: filters.types.filter((x) => x !== t) } });
  for (const b of filters.eventBuckets)
    chips.push({
      key: `e-${b}`,
      label: EVENT_LABELS[b] ?? b,
      patch: { eventBuckets: filters.eventBuckets.filter((x) => x !== b) },
    });
  for (const r of filters.recency)
    chips.push({
      key: `r-${r}`,
      label: RECENCY_LABELS[r] ?? r,
      patch: { recency: filters.recency.filter((x) => x !== r) },
    });
  if (filters.hasPrimaryContact)
    chips.push({ key: "pc", label: "Has primary contact", patch: { hasPrimaryContact: false } });

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <FacetChip
          key={c.key}
          label={c.label}
          active
          onClick={() => onRemove(c.patch)}
        />
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-1 text-xs font-medium text-sage-text hover:underline etched"
      >
        Clear all
      </button>
    </div>
  );
}

export { EVENT_LABELS, EVENT_BUCKETS };
