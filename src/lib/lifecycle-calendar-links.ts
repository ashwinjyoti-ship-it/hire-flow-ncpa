type LifecycleStatus = "enquiry" | "tentative" | "approved" | "confirmed" | "regret" | "cancelled";

type LifecycleDatedEntry = {
  milestone_type: string;
  milestone_date: string | null;
  event_start_date?: string | null;
};

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normaliseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1] ?? null;

  const imported = trimmed.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!imported) return null;
  const [, day, monthName, year] = imported;
  if (!day || !monthName || !year || day === "00") return null;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

export function getLifecycleCalendarHref(
  entries: LifecycleDatedEntry[],
  status: LifecycleStatus,
  today: Date = new Date(),
): string {
  const base = `/calendar?view=lifecycle&status=${encodeURIComponent(status)}`;
  const todayIso = isoDate(today);
  const dates = entries
    .filter((entry) => entry.milestone_type === status)
    .map((entry) => normaliseDate(entry.milestone_date))
    .filter((date): date is string => Boolean(date))
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
    .map((entry) => normaliseDate(entry.event_start_date) || normaliseDate(entry.milestone_date))
    .filter((date): date is string => Boolean(date))
    .sort((a, b) => a.localeCompare(b));

  if (dates.length === 0) return base;

  const nextDate = dates.find((date) => date >= todayIso);
  const targetDate = nextDate ?? dates[dates.length - 1];
  if (!targetDate) return base;
  return `${base}&from=${encodeURIComponent(targetDate)}`;
}
