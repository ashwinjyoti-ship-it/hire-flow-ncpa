/** Shared types for the Organisations faceted page. */

/** One organisation row, as returned by the extended GET /organisations endpoint. */
export type OrgSummary = {
  id: string;
  name: string;
  org_type: string | null;
  is_archived: number;
  event_count: number;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  last_event_date: string | null; // yyyy-mm-dd
  last_activity_at: string | null; // ISO datetime
};

export type OrgsResponse = {
  organisations: OrgSummary[];
  total: number;
};

/** Organisation type chips used by filters and new-event organisation capture. */
export const ORG_TYPES = ["School", "Foundation", "Production", "Cooperative", "Corporate", "Individual"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** The three event-count buckets the slider offers. */
export const EVENT_BUCKETS = ["1-3", "4-9", "10+"] as const;
export type EventBucket = (typeof EVENT_BUCKETS)[number];

/** The four Last-activity chips. */
export const RECENCY_BUCKETS = ["week", "month", "quarter", "inactive6"] as const;
export type RecencyBucket = (typeof RECENCY_BUCKETS)[number];

/** A single org's recency bucket resolved client-side. */
export const RECENCY_LABELS: Record<string, string> = {
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  inactive6: "Inactive 6+ months",
};

/**
 * The full filter state of the faceted panel. Empty arrays / false / "" mean
 * "facet inactive".
 */
export type Filters = {
  q: string;
  types: string[]; // subset of ORG_TYPES
  eventBuckets: string[]; // subset of EVENT_BUCKETS
  recency: string[]; // subset of RECENCY_BUCKETS
  hasPrimaryContact: boolean;
};

export const EMPTY_FILTERS: Filters = {
  q: "",
  types: [],
  eventBuckets: [],
  recency: [],
  hasPrimaryContact: false,
};

/** True when every facet is at its empty/default (i.e. nothing to filter on). */
export function filtersAreEmpty(f: Filters): boolean {
  return (
    !f.q &&
    f.types.length === 0 &&
    f.eventBuckets.length === 0 &&
    f.recency.length === 0 &&
    !f.hasPrimaryContact
  );
}
