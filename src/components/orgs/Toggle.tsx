/** Switch for boolean facets ("Has primary contact?") — Deep Terracotta when
 * on (selected state). Built on a native checkbox for accessibility; extends
 * the checkbox idiom used in EventEditPage.tsx. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="text-sm text-ink-secondary etched">{label}</span>
      <span className="relative inline-flex">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className="carved h-5 w-9 rounded-full bg-marble-shadow/50 transition-colors peer-checked:bg-terracotta-btnDark"
          aria-hidden
        />
        <span
          className="terracotta-pip pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-marble-highlight transition-transform peer-checked:translate-x-4 peer-checked:bg-terracotta"
          aria-hidden
        />
      </span>
    </label>
  );
}
