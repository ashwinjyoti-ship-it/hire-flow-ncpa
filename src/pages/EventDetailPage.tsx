import { PageHeader } from "../components/PageHeader";

export function EventDetailPage() {
  return (
    <div>
      <PageHeader title="Event" />
      <div className="carved-card rounded-2xl bg-marble-highlight/50 p-8 text-sm text-ink-secondary etched">
        <p className="text-ink-tertiary">This section is part of the active build roadmap.</p>
      </div>
    </div>
  );
}
