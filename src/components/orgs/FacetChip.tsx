/** Pill toggle for a single facet value (used in the left rail). Matches the
 * Marble+Sage chip idiom: small rounded-full pill, terracotta-tinted when
 * active (selected state uses the Deep Terracotta accent). */
export function FacetChip({
  label,
  count,
  active,
  onClick,
  title,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={
        "carved-btn inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium etched transition-colors " +
        (active
          ? "bg-terracotta-btn text-terracotta-text"
          : "bg-neutral-btn text-ink-secondary hover:bg-neutral-btn-hover")
      }
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={
            "rounded-full px-1.5 text-[10px] " +
            (active ? "bg-terracotta-btnDark/60 text-terracotta-text" : "bg-marble-shadow/60 text-ink-muted")
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}
