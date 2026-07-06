import type { EventStatus } from "../../worker/lib/state-machine";
import { STATUS_TOKEN } from "../../worker/lib/state-machine";

export type EventStatusSurface = {
  token: string;
  dot: string;
  badge: string;
  card: string;
  chip: string;
  row: string;
  border: string;
  text: string;
};

const SURFACES: Record<string, EventStatusSurface> = {
  enquiry: {
    token: "enquiry",
    dot: "bg-status-enquiry",
    badge: "bg-status-enquiry/15 text-ink-secondary ring-1 ring-status-enquiry/25",
    card: "bg-status-enquiry/10 ring-1 ring-status-enquiry/25 border-status-enquiry/30",
    chip: "bg-status-enquiry/15 text-ink-secondary ring-1 ring-status-enquiry/25",
    row: "bg-status-enquiry/10 hover:bg-status-enquiry/15 ring-1 ring-status-enquiry/20",
    border: "border-status-enquiry/35",
    text: "text-ink-secondary",
  },
  tentative: {
    token: "tentative",
    dot: "bg-status-tentative",
    badge: "bg-status-tentative/15 text-status-tentative ring-1 ring-status-tentative/25",
    card: "bg-status-tentative/10 ring-1 ring-status-tentative/25 border-status-tentative/30",
    chip: "bg-status-tentative/15 text-status-tentative ring-1 ring-status-tentative/25",
    row: "bg-status-tentative/10 hover:bg-status-tentative/15 ring-1 ring-status-tentative/20",
    border: "border-status-tentative/35",
    text: "text-status-tentative",
  },
  approved: {
    token: "approved",
    dot: "bg-status-approved",
    badge: "bg-status-approved/15 text-sage-text ring-1 ring-status-approved/25",
    card: "bg-status-approved/10 ring-1 ring-status-approved/25 border-status-approved/30",
    chip: "bg-status-approved/15 text-sage-text ring-1 ring-status-approved/25",
    row: "bg-status-approved/10 hover:bg-status-approved/15 ring-1 ring-status-approved/20",
    border: "border-status-approved/35",
    text: "text-sage-text",
  },
  confirmed: {
    token: "confirmed",
    dot: "bg-status-confirmed",
    badge: "bg-status-confirmed/15 text-sage-text ring-1 ring-status-confirmed/25",
    card: "bg-status-confirmed/10 ring-1 ring-status-confirmed/25 border-status-confirmed/30",
    chip: "bg-status-confirmed/15 text-sage-text ring-1 ring-status-confirmed/25",
    row: "bg-status-confirmed/10 hover:bg-status-confirmed/15 ring-1 ring-status-confirmed/20",
    border: "border-status-confirmed/35",
    text: "text-sage-text",
  },
  regret: {
    token: "regret",
    dot: "bg-status-regret",
    badge: "bg-status-regret/15 text-status-regret ring-1 ring-status-regret/25",
    card: "bg-status-regret/10 ring-1 ring-status-regret/25 border-status-regret/30",
    chip: "bg-status-regret/15 text-status-regret ring-1 ring-status-regret/25",
    row: "bg-status-regret/10 hover:bg-status-regret/15 ring-1 ring-status-regret/20",
    border: "border-status-regret/35",
    text: "text-status-regret",
  },
  cancelled: {
    token: "cancelled",
    dot: "bg-status-cancelled",
    badge: "bg-status-cancelled/15 text-status-cancelled ring-1 ring-status-cancelled/25",
    card: "bg-status-cancelled/10 ring-1 ring-status-cancelled/25 border-status-cancelled/30",
    chip: "bg-status-cancelled/15 text-status-cancelled ring-1 ring-status-cancelled/25",
    row: "bg-status-cancelled/10 hover:bg-status-cancelled/15 ring-1 ring-status-cancelled/20",
    border: "border-status-cancelled/35",
    text: "text-status-cancelled",
  },
};

export function getEventStatusSurface(status: EventStatus | string | null | undefined): EventStatusSurface {
  const token = status && STATUS_TOKEN[status as EventStatus] ? STATUS_TOKEN[status as EventStatus] : "enquiry";
  return SURFACES[token] ?? SURFACES.enquiry!;
}
