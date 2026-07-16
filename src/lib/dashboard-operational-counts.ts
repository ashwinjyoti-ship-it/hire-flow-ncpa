import type { EventStatus } from "../../worker/lib/state-machine";

export type OperationalLifecycleEntry = {
  id: string;
  event_id: string;
  title: string;
  status: EventStatus;
  milestone_date: string;
  enquiry_date?: string | null;
  event_start_date: string | null;
  event_end_date?: string | null;
  organisation_name: string | null;
  venues: string | null;
};

export type DashboardOperationalCounts = {
  activeEnquiries: number;
  awaitingConfirmation: number;
  confirmed: number;
};

const STATUS_RANK: Partial<Record<EventStatus, number>> = {
  enquiry: 1,
  tentative: 2,
  approved: 3,
  confirmed: 4,
  cancelled: 5,
  regret: 5,
};

function normalise(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function validIsoDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function subtractDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function logicalEventKey(entry: OperationalLifecycleEntry): string {
  const start = validIsoDate(entry.event_start_date);
  if (!start) return `event:${entry.event_id}`;
  return [normalise(entry.organisation_name), normalise(entry.title), start].join("|");
}

/**
 * Collapse duplicate imported records and keep the furthest current lifecycle
 * state for each logical event. Undated records stay distinct because there is
 * not enough evidence to merge them safely.
 */
export function dedupeLifecycleEntries<T extends OperationalLifecycleEntry>(entries: T[]): T[] {
  const groups = new Map<string, T>();
  for (const entry of entries) {
    const key = logicalEventKey(entry);
    const existing = groups.get(key);
    if (!existing || (STATUS_RANK[entry.status] ?? 0) > (STATUS_RANK[existing.status] ?? 0)) {
      groups.set(key, entry);
    }
  }
  return [...groups.values()];
}

export function operationalLifecycleEntries<T extends OperationalLifecycleEntry>(entries: T[], todayIso: string): T[] {
  const enquiryCutoff = subtractDays(todayIso, 30);
  return dedupeLifecycleEntries(entries).filter((entry) => {
    const end = validIsoDate(entry.event_end_date) ?? validIsoDate(entry.event_start_date);
    if (entry.status === "enquiry") {
      if (end) return end >= todayIso;
      const enquiryDate = validIsoDate(entry.enquiry_date);
      return enquiryDate != null && enquiryDate >= enquiryCutoff;
    }
    if (entry.status === "tentative" || entry.status === "approved") return !end || end >= todayIso;
    if (entry.status === "confirmed") {
      const start = validIsoDate(entry.event_start_date);
      return Boolean(start && start >= todayIso);
    }
    return false;
  });
}

export function dashboardOperationalCounts<T extends OperationalLifecycleEntry>(entries: T[], todayIso: string): DashboardOperationalCounts {
  const operational = operationalLifecycleEntries(entries, todayIso);
  return {
    activeEnquiries: operational.filter((entry) => entry.status === "enquiry").length,
    awaitingConfirmation: operational.filter((entry) => entry.status === "tentative" || entry.status === "approved").length,
    confirmed: operational.filter((entry) => entry.status === "confirmed").length,
  };
}
