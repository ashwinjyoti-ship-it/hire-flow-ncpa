/** Lookups hook: fetches dropdown options grouped by list key. */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

type LookupsResponse = {
  lookups: Record<string, Array<{ value: string; metadata?: Record<string, unknown> }>>;
};

export function useLookups() {
  return useQuery({
    queryKey: ["lookups"],
    queryFn: () => apiGet<LookupsResponse>("/lookups"),
    staleTime: 5 * 60_000,
  });
}

/** Format an ISO date string (yyyy-mm-dd) to a readable IST-style display. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00+05:30` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** Format an ISO timestamp for display in IST. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
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
