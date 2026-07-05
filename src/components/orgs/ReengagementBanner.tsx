/** "Same time last year" re-engagement banner.
 *
 * Sits above the filters and is always rendered on load. Shows up to 4 cards in
 * a horizontal scroll row of orgs whose last event fell within ±N days of
 * `bannerTarget(today)` (today +1 month −1 year). To guarantee ≥1 card on load,
 * the window widens progressively: ±14d → ±30d → ±90d.
 *
 * "Reach out" opens a mailto to the primary contact (when present), then dismisses
 * the card for 30 days (localStorage-backed) and shows a toast. "See all N
 * matches →" calls `onSeeAll`, letting the page pre-filter the faceted panel. */
import { useMemo, useRef, useState } from "react";
import { addDays, bannerTarget, isoDate, withinRange } from "../../lib/dates";
import { formatDate } from "../../lib/use-lookups";
import { dismissId, isDismissed } from "./Toast";
import { BannerCard } from "./BannerCard";
import type { OrgSummary } from "./types";

type Window = { days: number; label: string };
const WINDOWS: Window[] = [
  { days: 14, label: "±2 weeks around the same date last year" },
  { days: 30, label: "±~1 month around the same date last year" },
  { days: 90, label: "±~3 months around the same date last year" },
];

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ReengagementBanner({
  orgs,
  onSeeAll,
  onToast,
}: {
  orgs: OrgSummary[];
  onSeeAll: (windowDays: number) => void;
  onToast: (text: string) => void;
}) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    // Seed from localStorage so reloads respect prior dismissals.
    return new Set(orgs.filter((o) => isDismissed(o.id)).map((o) => o.id));
  });
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Pick the tightest window that yields ≥1 candidate (after exclusions).
  const { window: chosen, matches } = useMemo(() => {
    const target = bannerTarget();
    let picked: Window = { days: 14, label: WINDOWS[0]?.label ?? "" };
    let pickedMatches: OrgSummary[] = [];
    for (const w of WINDOWS) {
      const fromIso = isoDate(addDays(target, -w.days));
      const toIso = isoDate(addDays(target, w.days));
      const inWindow = orgs.filter(
        (o) => !hiddenIds.has(o.id) && withinRange(o.last_event_date, fromIso, toIso),
      );
      // Remember the widest window we've seen as the fallback so `chosen` is
      // always defined even when no window has any matches.
      picked = w;
      if (inWindow.length > 0) {
        pickedMatches = inWindow;
        break;
      }
    }
    return { window: picked, matches: pickedMatches };
  }, [orgs, hiddenIds]);

  const target = bannerTarget();
  const targetIso = isoDate(target);
  const subtitle =
    `Reach out ahead of ${target.toLocaleDateString("en-IN", { month: "long" })} to invite a repeat booking. ` +
    `Showing events from ${formatRange(target, chosen.days)}. (${chosen.label})`;

  // For the heading count, use all matches in the chosen window (incl. dismissed)
  // so the number is stable as the user dismisses cards.
  const totalInWindow = useMemo(() => {
    const fromIso = isoDate(addDays(target, -chosen.days));
    const toIso = isoDate(addDays(target, chosen.days));
    return orgs.filter((o) => withinRange(o.last_event_date, fromIso, toIso)).length;
  }, [orgs, chosen, target]);

  function handleReachOut(org: OrgSummary) {
    if (org.primary_contact_email) {
      const subject = encodeURIComponent(`Following up — ${org.name} booking this ${target.toLocaleDateString("en-IN", { month: "long" })}`);
      window.location.href = `mailto:${org.primary_contact_email}?subject=${subject}`;
    } else {
      onToast(`No email on file for ${org.name}`);
      return;
    }
    dismissId(org.id);
    setHiddenIds((prev) => new Set(prev).add(org.id));
    onToast("Logged — we'll hide for 30 days");
  }

  function scrollBy(dx: number) {
    scrollerRef.current?.scrollBy({ left: dx, behavior: "smooth" });
  }

  // Empty state: even the widest window has nothing. Show a muted banner so the
  // section is still present (spec: "always shows ≥1 card" — handled by widening;
  // if truly nothing exists, we surface that honestly rather than faking data).
  if (matches.length === 0) {
    return (
      <section className="carved-card mb-6 rounded-2xl bg-marble-highlight/50 p-5">
        <h2 className="text-base font-semibold text-ink-primary etched-deep">Same time last year</h2>
        <p className="mt-1 text-xs text-ink-muted etched">
          No prior events fall near {formatDate(targetIso)} this year. Check back next month, or browse all organisations below.
        </p>
      </section>
    );
  }

  return (
    <section className="carved-card mb-6 rounded-2xl bg-marble-highlight/50 p-5">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink-primary etched-deep">
            Same time last year — {totalInWindow} match{totalInWindow === 1 ? "" : "es"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted etched">{subtitle}</p>
        </div>
      </div>

      <div className="relative">
        <div
          ref={scrollerRef}
          className="scroll-slim flex gap-3 overflow-x-auto pb-1"
        >
          {matches.slice(0, 8).map((o) => (
            <BannerCard key={o.id} org={o} onReachOut={handleReachOut} />
          ))}
        </div>
        {matches.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => scrollBy(-300)}
              aria-label="Scroll left"
              className="carved-btn absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-marble-highlight/90 p-1.5 text-ink-secondary hover:bg-marble-highlight"
            >
              <ChevronIcon className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(300)}
              aria-label="Scroll right"
              className="carved-btn absolute right-0 top-1/2 -translate-y-1/2 rounded-full bg-marble-highlight/90 p-1.5 text-ink-secondary hover:bg-marble-highlight"
            >
              <ChevronIcon />
            </button>
          </>
        )}
      </div>

      {totalInWindow > matches.length + hiddenIds.size && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onSeeAll(chosen.days)}
            className="text-xs font-medium text-sage-text hover:underline etched"
          >
            See all {totalInWindow} matches →
          </button>
        </div>
      )}
    </section>
  );
}

function formatRange(target: Date, days: number): string {
  const from = addDays(target, -days);
  const to = addDays(target, days);
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return `${fmt(from)} – ${fmt(to)}`;
}
