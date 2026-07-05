import { PageHeader } from "../components/PageHeader";

export function TasksPage() {
  return (
    <div>
      <PageHeader title="Tasks" />
      <div className="carved-card rounded-2xl bg-marble-highlight/40 p-8 text-sm text-ink-secondary etched">
        <p className="text-ink-tertiary">This section is part of the active build roadmap.</p>
      </div>
    </div>
  );
}
