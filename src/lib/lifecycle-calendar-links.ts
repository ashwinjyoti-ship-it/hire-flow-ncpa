type LifecycleStatus = "enquiry" | "tentative" | "approved" | "confirmed" | "regret" | "cancelled";

type LifecycleDatedEntry = {
  milestone_type: string;
  milestone_date: string | null;
  event_start_date?: string | null;
};

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getLifecycleCalendarHref(
  entries: LifecycleDatedEntry[],
  status: LifecycleStatus,
  today: Date = new Date(),
): string {
  const base = `/calendar?view=lifecycle&status=${encodeURIComponent(status)}`;
  const todayIso = isoDate(today);
  const dates = entries
    .filter((entry) => entry.milestone_type === status && entry.milestone_date)
    .map((entry) => entry.milestone_date as string)
    .sort((a, b) => a.localeCompare(b));

  if (dates.length === 0) return base;

  const nextDate = dates.find((date) => date >= todayIso);
  const targetDate = nextDate ?? dates[dates.length - 1];
  if (!targetDate) return base;
  return `${base}&from=${encodeURIComponent(targetDate)}`;
}

export function getConfirmedShowCalendarHref(
  entries: LifecycleDatedEntry[],
  today: Date = new Date(),
): string {
  const base = "/calendar?view=show&status=confirmed";
  const todayIso = isoDate(today);
  const dates = entries
    .filter((entry) => entry.milestone_type === "confirmed")
    .map((entry) => entry.event_start_date || entry.milestone_date)
    .filter((date): date is string => Boolean(date))
    .sort((a, b) => a.localeCompare(b));

  if (dates.length === 0) return base;

  const nextDate = dates.find((date) => date >= todayIso);
  const targetDate = nextDate ?? dates[dates.length - 1];
  if (!targetDate) return base;
  return `${base}&from=${encodeURIComponent(targetDate)}`;
}
