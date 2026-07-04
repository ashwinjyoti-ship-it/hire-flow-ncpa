import { PageHeader } from "../components/PageHeader";

export function CalendarPage() {
  return (
    <div>
      <PageHeader title="Calendar" />
      <div className="carved-card rounded-2xl bg-marble-highlight/50 p-8 text-sm text-ink-secondary etched">
        <p className="text-ink-tertiary">This section is part of the active build roadmap.</p>
      </div>
    </div>
  );
}
