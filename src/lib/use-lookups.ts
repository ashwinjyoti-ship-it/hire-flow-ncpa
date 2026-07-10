/** Lookups hook: fetches dropdown options grouped by list key. */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

type LookupsResponse = {
  lookups: Record<string, Array<{ value: string; metadata?: Record<string, unknown> }>>;
};

const UI_DATE_LOCALE = "en-GB";
const UI_TIME_ZONE = "Asia/Kolkata";

export function useLookups() {
  return useQuery({
    queryKey: ["lookups"],
    queryFn: () => apiGet<LookupsResponse>("/lookups"),
    staleTime: 5 * 60_000,
  });
}

function parseUiDate(value: string): Date {
  return new Date(value.length <= 10 ? `${value}T00:00:00+05:30` : value);
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/** Format an ISO date string (yyyy-mm-dd) to DD/MM/YYYY in IST. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseUiDate(iso);
  if (isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat(UI_DATE_LOCALE, {
    timeZone: UI_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  return `${partValue(parts, "day")}/${partValue(parts, "month")}/${partValue(parts, "year")}`;
}

/** Format an ISO timestamp for display in IST as DD/MM/YYYY HH:MM (24-hour). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat(UI_DATE_LOCALE, {
    timeZone: UI_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  return `${partValue(parts, "day")}/${partValue(parts, "month")}/${partValue(parts, "year")} ${partValue(parts, "hour")}:${partValue(parts, "minute")}`;
}

/** Format a time-only string for display as HH:MM (24-hour). */
export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const trimmed = value.trim();
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (!Number.isNaN(hours) && !Number.isNaN(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return value;
  const parts = new Intl.DateTimeFormat(UI_DATE_LOCALE, {
    timeZone: UI_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  return `${partValue(parts, "hour")}:${partValue(parts, "minute")}`;
}

/** Format a time range as HH:MM - HH:MM (24-hour). */
export function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "—";
  if (!end) return formatTime(start);
  return `${formatTime(start)} - ${formatTime(end)}`;
}

/** Format a number as INR currency. */
export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

/**
 * Format a duration given in MINUTES as a compact human string.
 * Uses days / hours / minutes (no leading-zero sub-units):
 *   30 -> "30m", 90 -> "1h 30m", 1500 -> "1d 1h", 1440 -> "1d"
 * Returns "—" for null/undefined.
 */
export function formatDuration(mins: number | null | undefined): string {
  if (mins == null) return "—";
  const days = Math.floor(mins / (24 * 60));
  const rem = mins - days * 24 * 60;
  const h = Math.floor(rem / 60);
  const m = rem % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${String(m).padStart(2, "0")}m`);
  return parts.length ? parts.join(" ") : "0m";
}
