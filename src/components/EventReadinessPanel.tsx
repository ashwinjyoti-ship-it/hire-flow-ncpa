import { Link } from "react-router-dom";
import type { EventFormReadiness, ReadinessSection, ReadinessState } from "../../worker/lib/event-readiness";
import { venueScheduleIssueLabel, VENUES_SCHEDULE_READINESS_KEY } from "../../worker/lib/venue-schedule-readiness";

type EventReadinessPanelProps = {
  eventId: string;
  readiness: EventFormReadiness;
  detailed?: boolean;
};

const STATE_LABELS: Record<ReadinessState, string> = {
  missing: "Missing",
  partial: "In progress",
  almost: "Nearly ready",
  complete: "Complete",
  not_applicable: "Not applicable",
};

const STATE_CLASSES: Record<ReadinessState, string> = {
  missing: "border-status-cancelled/25 bg-status-cancelled/10 text-status-cancelled",
  partial: "border-status-awaitingApproval/25 bg-status-awaitingApproval/10 text-status-awaitingApproval",
  almost: "border-status-tentative/25 bg-status-tentative/10 text-status-tentative",
  complete: "border-status-confirmed/25 bg-status-confirmed/10 text-sage-text",
  not_applicable: "border-ink-muted/20 bg-marble-shadow/30 text-ink-muted",
};

function AutomatedCheckbox({ section }: { section: ReadinessSection }) {
  const checked = section.state === "complete" || section.state === "not_applicable";
  const mixed = section.state === "partial" || section.state === "almost";
  return (
    <span
      role="checkbox"
      aria-readonly="true"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={`${section.label}: ${STATE_LABELS[section.state]}`}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold ${STATE_CLASSES[section.state]}`}
    >
      {checked ? "✓" : mixed ? "–" : ""}
    </span>
  );
}

function VenueScheduleHighlight({ eventId, section }: { eventId: string; section: ReadinessSection }) {
  const complete = section.state === "complete";
  const issueCount = section.missingLabels.length;
  const venueChips = section.missingLabels
    .slice(0, 4)
    .map((label, index) => ({
      key: section.missingKeys[index] ?? label,
      label: venueScheduleIssueLabel(label),
    }));

  return (
    <div
      className={
        "mt-4 rounded-xl border p-4 " +
        (complete
          ? "border-status-confirmed/20 bg-status-confirmed/8"
          : "border-status-cancelled/25 bg-status-cancelled/10")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted etched">Venues &amp; schedule</p>
          {complete ? (
            <p className="mt-1 text-sm font-semibold text-sage-text etched">
              {section.total === 1 ? "Venue schedule is set" : `All ${section.total} venues have activity schedules`}
            </p>
          ) : issueCount === 1 ? (
            <p className="mt-1 text-sm font-semibold text-ink-primary etched-deep">{section.missingLabels[0]}</p>
          ) : (
            <p className="mt-1 text-sm font-semibold text-ink-primary etched-deep">
              {issueCount} {issueCount === 1 ? "venue still needs" : "venues still need"} activity schedules
            </p>
          )}
          {!complete && venueChips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {venueChips.map((chip) => (
                <span
                  key={chip.key}
                  className="max-w-[11rem] truncate rounded-full bg-marble-highlight/75 px-2.5 py-0.5 text-[11px] font-medium text-ink-secondary etched"
                >
                  {chip.label}
                </span>
              ))}
              {issueCount > venueChips.length && (
                <span className="self-center text-[11px] text-ink-muted etched">
                  +{issueCount - venueChips.length} more
                </span>
              )}
            </div>
          )}
        </div>
        <Link
          to={`/events/${eventId}?tab=venues&field=${VENUES_SCHEDULE_READINESS_KEY}`}
          className="carved-btn shrink-0 rounded-full bg-neutral-btn px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-secondary etched"
        >
          {complete ? "View schedule" : "Fix schedule"}
        </Link>
      </div>
    </div>
  );
}

function RequirementSectionRow({ eventId, section }: { eventId: string; section: ReadinessSection }) {
  return (
    <div
      className={`group flex items-start gap-3 rounded-xl border p-4 transition-shadow hover:shadow-sm ${STATE_CLASSES[section.state]}`}
    >
      <AutomatedCheckbox section={section} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold etched-deep">{section.label}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider etched">{STATE_LABELS[section.state]}</span>
        </span>
        <span className="mt-1 block text-xs etched">
          {section.state === "not_applicable" ? "Not applicable" : `${section.filled} of ${section.total} filled`}
        </span>
        {section.missingLabels.length > 0 && (
          <span className="mt-3 block border-t border-current/15 pt-2.5">
            <span className="block text-[10px] font-bold uppercase tracking-wider opacity-75">Still needed</span>
            <span className="mt-1.5 grid gap-x-5 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {section.missingLabels.map((label, index) => (
                <Link
                  key={section.missingKeys[index] ?? label}
                  to={`/events/${eventId}/edit?step=2&section=${encodeURIComponent(section.formSection)}&field=${encodeURIComponent(section.missingKeys[index] ?? "")}&venue=0`}
                  className="flex items-start gap-1.5 rounded-md px-1 py-0.5 etched underline decoration-current/25 underline-offset-2 hover:bg-marble-highlight/35 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
                >
                  <span aria-hidden="true" className="mt-[0.15rem] opacity-60">•</span>
                  <span>{label}</span>
                  <span aria-hidden="true" className="ml-auto opacity-55">↗</span>
                </Link>
              ))}
            </span>
          </span>
        )}
        <Link
          to={`/events/${eventId}/edit?step=2&section=${encodeURIComponent(section.formSection)}&venue=0`}
          className="mt-3 inline-flex rounded-md text-[10px] font-semibold uppercase tracking-wider opacity-70 underline decoration-current/25 underline-offset-2 hover:opacity-100 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
        >
          Open {section.label} section →
        </Link>
      </span>
    </div>
  );
}

export function EventReadinessPanel({ eventId, readiness, detailed = false }: EventReadinessPanelProps) {
  const venueSection = readiness.sections.find((section) => section.key === "venues_schedule");
  const requirementSections = readiness.sections.filter((section) => section.key !== "venues_schedule");
  const incomplete = requirementSections.filter((section) => section.state !== "complete" && section.state !== "not_applicable");

  return (
    <section className="carved-card rounded-2xl border border-marble-shadow/45 bg-marble-highlight/65 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Event readiness</h3>
          <p className="mt-1 text-sm text-ink-secondary etched">
            {readiness.percentage}% ready · {readiness.missingCount} {readiness.missingCount === 1 ? "detail" : "details"} missing before event
          </p>
        </div>
        <div className="min-w-36 text-right">
          <div className="text-3xl font-semibold tabular-nums text-ink-primary etched-deep">{readiness.percentage}%</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-marble-shadow/50 shadow-inner" aria-hidden="true">
            <div className="h-full rounded-full bg-sage/75 transition-[width]" style={{ width: `${readiness.percentage}%` }} />
          </div>
        </div>
      </div>

      {venueSection && <VenueScheduleHighlight eventId={eventId} section={venueSection} />}

      {detailed ? (
        <div className="mt-5 grid gap-3">
          {requirementSections.map((section) => (
            <RequirementSectionRow key={section.key} eventId={eventId} section={section} />
          ))}
        </div>
      ) : incomplete.length > 0 ? (
        <div className="mt-4 border-t border-marble-shadow/35 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted etched">Missing before event</p>
          <div className="mt-2 grid gap-1.5 md:grid-cols-2">
            {incomplete.slice(0, 4).map((section) => (
              <p key={section.key} className="text-xs text-ink-secondary etched">
                <span className="font-semibold">{section.label}:</span> {section.missingLabels.slice(0, 3).join(", ")}
              </p>
            ))}
          </div>
        </div>
      ) : venueSection?.state === "complete" ? (
        <p className="mt-4 border-t border-marble-shadow/35 pt-3 text-sm font-medium text-sage-text etched">All required event-form sections are ready.</p>
      ) : null}
    </section>
  );
}
