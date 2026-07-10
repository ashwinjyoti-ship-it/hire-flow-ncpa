import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { useLookups, formatDate, formatDuration } from "../lib/use-lookups";
import { ORG_TYPES } from "../components/orgs/types";
import type { EventInputT, VenueBookingInputT, ScheduleEntryInputT } from "../../worker/lib/types";
import { ACTIVITY_TYPES } from "../../worker/lib/types";

const STEPS = ["Event & Client", "Venues & Schedule", "Requirements", "Documents", "Review"] as const;
const STEP_SHORT_LABELS = ["Client", "Schedule", "Requirements", "Documents", "Review"] as const;
const EVENT_TYPE_OPTIONS = [
  { value: "EE", label: "EE" },
  { value: "FR", label: "FR (Foundation)" },
  { value: "VFH", label: "VFH (Venue For Hire)" },
  { value: "Free Event", label: "Free Event" },
] as const;

type OrgListItem = { id: string; name: string; org_type: string | null };
type ReviewEntry = { label: string; value: string };
type DuplicateCheckResponse = {
  duplicates: Array<{
    id: string;
    event_code: string | null;
    title: string;
    status: string;
    event_start_date: string | null;
    event_end_date: string | null;
    organisation_name: string | null;
    venues: string | null;
  }>;
};

/** Shape returned by GET /events/:id. Only the fields we need to hydrate the form. */
type EventDetailResponse = {
  event: Record<string, unknown> & {
    id: string;
    title: string;
    description: string | null;
    organisation_id: string;
    primary_contact_id: string | null;
    event_type: EventInputT["event_type"];
    program_officer: string | null;
    event_owner: string | null;
    event_owner_id: string | null;
    event_start_date: string | null;
    event_end_date: string | null;
    enquiry_source: string | null;
    priority: EventInputT["priority"];
    requirements: Record<string, unknown> | string | null;
    notes: string | null;
  };
  venue_bookings: Array<{
    id: string;
    venue: string;
    booking_status: VenueBookingInputT["booking_status"];
    number_of_shows: number;
    requirements: Record<string, unknown> | string | null;
    notes: string | null;
    schedule_entries: Array<{
      id: string;
      activity_type: ScheduleEntryInputT["activity_type"];
      activity_date: string;
      start_time: string | null;
      end_time: string | null;
      with_ac_start: string | null;
      with_ac_end: string | null;
      with_ac_minutes: number | null;
      without_ac_start: string | null;
      without_ac_end: string | null;
      without_ac_minutes: number | null;
      notes: string | null;
    }>;
  }>;
};

/** Parse a requirements value that may arrive as a JSON string or already-decoded object. */
function parseRequirements(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function normaliseEventType(value: unknown): EventInputT["event_type"] {
  switch (value) {
    case "EE":
    case "FR":
    case "VFH":
    case "Free Event":
      return value;
    case "FE":
      return "Free Event";
    case "FR (Foundation)":
      return "FR";
    case "VFH (Venue For Hire)":
      return "VFH";
    default:
      return null;
  }
}

/** Compute minutes between two HH:MM times (end − start). Returns null if either missing or end<=start. */
function diffMinutes(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (sh == null || sm == null || eh == null || em == null) return null;
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // overnight wrap
  if (mins === 0) return 0;
  return mins;
}
// (formatDuration is imported from lib/use-lookups for consistent hh/d rendering)

function isFilledReviewValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function formatReviewValue(value: unknown): string | null {
  if (!isFilledReviewValue(value)) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatReviewValue(item))
      .filter((item): item is string => Boolean(item));
    return items.length > 0 ? items.join(", ") : null;
  }
  return JSON.stringify(value);
}

function titleCaseWords(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatReviewLabel(key: string): string {
  const explicitLabels: Record<string, string> = {
    no_of_pax: "No. of Pax",
    crew_cards: "No. of Crew Cards",
    liquor_licence: "Liquor Licence",
    liquor_licence_details: "Liquor Licence Details",
    sound_call_time: "Sound Call Time",
    light_call_time: "Light Call Time",
    recording_type: "Recording Type",
    camera_count: "No. of Cameras",
  };
  return explicitLabels[key] ?? titleCaseWords(key);
}

function formatOperatingWindow(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start) return null;
  return end ? `${start} → ${end}` : start;
}

function formatScheduleSummary(entry: ScheduleEntryInputT): string {
  const segments = [
    titleCaseWords(entry.activity_type),
    entry.activity_date,
    entry.start_time && entry.end_time ? `${entry.start_time} - ${entry.end_time}` : null,
    entry.with_ac_start && entry.with_ac_end
      ? `With AC ${entry.with_ac_start} - ${entry.with_ac_end} (${formatDuration(entry.with_ac_minutes ?? diffMinutes(entry.with_ac_start, entry.with_ac_end))})`
      : null,
    entry.without_ac_start && entry.without_ac_end
      ? `Without AC ${entry.without_ac_start} - ${entry.without_ac_end} (${formatDuration(entry.without_ac_minutes ?? diffMinutes(entry.without_ac_start, entry.without_ac_end))})`
      : null,
    entry.notes,
  ].filter((segment): segment is string => Boolean(segment && segment.trim().length > 0));

  return segments.join(" · ");
}

function buildReviewItems({
  form,
  organisationName,
  organisationType,
  isVfh,
}: {
  form: EventInputT;
  organisationName: string | null;
  organisationType: string;
  isVfh: boolean;
}): ReviewEntry[] {
  const items: ReviewEntry[] = [];
  const pushItem = (label: string, value: unknown) => {
    const text = formatReviewValue(value);
    if (text) items.push({ label, value: text });
  };

  pushItem("Organisation", organisationName);
  pushItem("Organisation Type", organisationType);
  pushItem("Event Name", form.title);
  pushItem("Description", form.description);
  pushItem("Type", normaliseEventType(form.event_type));
  pushItem("Enquiry Source", form.enquiry_source);
  pushItem("Program Officer", form.program_officer);
  pushItem("Owner", form.event_owner);
  pushItem("Operating Window", formatOperatingWindow(form.event_start_date, form.event_end_date));

  form.venue_bookings.forEach((venueBooking, venueIndex) => {
    const labelPrefix = `Venue ${venueIndex + 1}`;
    pushItem(labelPrefix, venueBooking.venue);
    pushItem(`${labelPrefix} Booking Status`, titleCaseWords(venueBooking.booking_status));
    pushItem(`${labelPrefix} Number of Shows`, venueBooking.number_of_shows);
    pushItem(`${labelPrefix} Notes`, venueBooking.notes);
    venueBooking.schedule_entries.forEach((entry, scheduleIndex) => {
      pushItem(`Schedule ${venueIndex + 1}.${scheduleIndex + 1}`, formatScheduleSummary(entry));
    });
  });

  const requirements = (form.requirements ?? {}) as Record<string, unknown>;
  Object.entries(requirements).forEach(([key, value]) => {
    pushItem(formatReviewLabel(key), value);
  });

  if (isVfh) pushItem("VFH Approval", "Will apply (VFH)");

  return items;
}

export function EventEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: lookups } = useLookups();
  const isEdit = Boolean(id);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [newOrganisationType, setNewOrganisationType] = useState("");
  const [selectedOrganisation, setSelectedOrganisation] = useState<OrgListItem | null>(null);

  // Form state
  const [form, setForm] = useState<EventInputT>({
    title: "",
    description: null,
    organisation_id: "",
    primary_contact_id: null,
    event_type: null,
    program_officer: null,
    event_owner: null,
    event_owner_id: null,
    event_start_date: null,
    event_end_date: null,
    enquiry_source: null,
    priority: "medium",
    requirements: null,
    notes: null,
    venue_bookings: [{ venue: "", booking_status: "tentative", number_of_shows: 1, requirements: null, notes: null, schedule_entries: [] }],
  });
  // Single-day toggle: when checked, end date is hidden and submitted as null.
  // Defaults ON (most events are single-day). Synced from existing form data on edit.
  const [singleDay, setSingleDay] = useState(true);

  // In edit mode, hydrate the form from the existing event. Without this the
  // edit page renders an empty form regardless of which event was opened —
  // affecting both the lifecycle and show calendars, which both route here via
  // the detail page's Edit button.
  const [hydrated, setHydrated] = useState(false);
  const { data: existing, isLoading: existingLoading } = useQuery({
    queryKey: ["event", id, "edit"],
    queryFn: () => apiGet<EventDetailResponse>(`/events/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!isEdit || !existing || hydrated) return;
    const e = existing.event;
    const bookings: VenueBookingInputT[] = existing.venue_bookings?.length
      ? existing.venue_bookings.map((vb) => ({
          venue: vb.venue ?? "",
          booking_status: (vb.booking_status === "confirmed" ? "confirmed" : "tentative") as VenueBookingInputT["booking_status"],
          number_of_shows: vb.number_of_shows ?? 1,
          requirements: parseRequirements(vb.requirements),
          notes: vb.notes ?? null,
          schedule_entries: (vb.schedule_entries ?? []).map((se) => ({
            activity_type: se.activity_type,
            activity_date: se.activity_date,
            start_time: se.start_time,
            end_time: se.end_time,
            with_ac_start: se.with_ac_start,
            with_ac_end: se.with_ac_end,
            with_ac_minutes: se.with_ac_minutes,
            without_ac_start: se.without_ac_start,
            without_ac_end: se.without_ac_end,
            without_ac_minutes: se.without_ac_minutes,
            notes: se.notes,
          })),
        }))
      : [{ venue: "", booking_status: "tentative", number_of_shows: 1, requirements: null, notes: null, schedule_entries: [] }];

    setForm({
      title: e.title ?? "",
      description: e.description ?? null,
      organisation_id: e.organisation_id ?? "",
      primary_contact_id: e.primary_contact_id ?? null,
      event_type: normaliseEventType(e.event_type),
      program_officer: e.program_officer ?? null,
      event_owner: e.event_owner ?? null,
      event_owner_id: (e as { event_owner_id?: string | null }).event_owner_id ?? null,
      event_start_date: e.event_start_date ?? null,
      event_end_date: e.event_end_date ?? null,
      enquiry_source: e.enquiry_source ?? null,
      priority: e.priority ?? "medium",
      requirements: parseRequirements(e.requirements),
      notes: e.notes ?? null,
      venue_bookings: bookings,
    });
    setSingleDay(!e.event_end_date);
    setHydrated(true);
  }, [isEdit, existing, hydrated]);

  useEffect(() => {
    if (!form.organisation_id || form.organisation_id.startsWith("new:")) {
      setSelectedOrganisation(null);
    }
  }, [form.organisation_id]);

  const update = (patch: Partial<EventInputT>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation<string | undefined, Error, void>({
    mutationFn: async () => {
      // If organisation_id is a temporary "new:<name>" token, create the org first.
      let orgId = form.organisation_id;
      if (orgId.startsWith("new:")) {
        const name = orgId.slice(4).trim();
        const created = await apiPost<{ id: string }>("/organisations", { name, org_type: newOrganisationType || null });
        orgId = created.id;
      }
      const payload = { ...form, organisation_id: orgId, event_end_date: singleDay ? null : form.event_end_date };
      if (isEdit && id) {
        const { venue_bookings: _vb, ...rest } = payload;
        void _vb;
        await apiPut(`/events/${id}`, rest);
        return undefined;
      }
      const res = await apiPost<{ id: string }>("/events", payload);
      return res.id;
    },
    onSuccess: (createdId) => navigate(`/events/${createdId ?? id}`),
    onError: (e: Error) => setError(e.message),
  });

  const venues = lookups?.lookups.venue ?? [];
  const programOfficers = lookups?.lookups.program_officer ?? [];
  const sources = lookups?.lookups.enquiry_source ?? [];
  const isVfh = form.event_type === "VFH";

  // Phase 8b: the Event Owner dropdown is sourced from real accounts. Choosing
  // one sets both the display label (event_owner) and the identity FK
  // (event_owner_id), so tasks auto-route and "My events" works.
  const { data: usersData } = useQuery<{ users: Array<{ id: string; name: string; is_active: number }> }>({
    queryKey: ["users"],
    queryFn: () => apiGet("/users"),
  });
  const activeOwners = (usersData?.users ?? []).filter((u) => u.is_active === 1);
  const trimmedTitle = form.title.trim();
  const duplicateCheckReady = Boolean(
    form.event_start_date
      && trimmedTitle
      && form.organisation_id
      && !form.organisation_id.startsWith("new:")
  );
  const duplicateQuery = new URLSearchParams({
    org: form.organisation_id,
    title: trimmedTitle,
    date: form.event_start_date ?? "",
    ...(id ? { exclude: id } : {}),
  });
  const { data: duplicateData } = useQuery<DuplicateCheckResponse>({
    queryKey: ["event-duplicates", form.organisation_id, trimmedTitle, form.event_start_date ?? "", id ?? ""],
    queryFn: () => apiGet<DuplicateCheckResponse>(`/events/duplicates?${duplicateQuery.toString()}`),
    enabled: duplicateCheckReady,
    staleTime: 10_000,
  });
  const duplicates = duplicateData?.duplicates ?? [];
  const reviewOrganisationName = useMemo(() => {
    if (form.organisation_id.startsWith("new:")) return `${form.organisation_id.slice(4)} (new)`;
    return selectedOrganisation?.name ?? null;
  }, [form.organisation_id, selectedOrganisation]);
  const reviewItems = useMemo(() => buildReviewItems({
    form,
    organisationName: reviewOrganisationName,
    organisationType: newOrganisationType,
    isVfh,
  }), [form, reviewOrganisationName, newOrganisationType, isVfh]);

  // ---- Venue booking helpers ----
  const addVenue = () => {
    setForm((f) => ({
      ...f,
      venue_bookings: [...f.venue_bookings, { venue: "", booking_status: "tentative", number_of_shows: 1, requirements: null, notes: null, schedule_entries: [] }],
    }));
  };
  const removeVenue = (idx: number) => setForm((f) => ({ ...f, venue_bookings: f.venue_bookings.filter((_, i) => i !== idx) }));
  const updateVenue = (idx: number, patch: Partial<VenueBookingInputT>) =>
    setForm((f) => ({ ...f, venue_bookings: f.venue_bookings.map((vb, i) => (i === idx ? { ...vb, ...patch } : vb)) }));

  const addScheduleEntry = (vIdx: number) =>
    updateVenue(vIdx, {
      schedule_entries: [...(form.venue_bookings[vIdx]?.schedule_entries ?? []), {
        activity_type: "show", activity_date: form.event_start_date ?? "", start_time: null, end_time: null,
        with_ac_start: null, with_ac_end: null, with_ac_minutes: null,
        without_ac_start: null, without_ac_end: null, without_ac_minutes: null,
        notes: null,
      }],
    });
  const removeScheduleEntry = (vIdx: number, sIdx: number) =>
    updateVenue(vIdx, { schedule_entries: (form.venue_bookings[vIdx]?.schedule_entries ?? []).filter((_, i) => i !== sIdx) });
  const updateScheduleEntry = (vIdx: number, sIdx: number, patch: Partial<ScheduleEntryInputT>) =>
    updateVenue(vIdx, {
      schedule_entries: (form.venue_bookings[vIdx]?.schedule_entries ?? []).map((se, i) => {
        if (i !== sIdx) return se;
        const merged = { ...se, ...patch };
        // Auto-recompute AC durations whenever their start/end changes.
        const withMin = diffMinutes(merged.with_ac_start, merged.with_ac_end);
        const withoutMin = diffMinutes(merged.without_ac_start, merged.without_ac_end);
        return { ...merged, with_ac_minutes: withMin, without_ac_minutes: withoutMin };
      }),
    });

  // ---- Requirements helpers (conditional fields) ----
  // NOTE: must compare against the actual yes-value, NOT Boolean(value) —
  // Boolean("No") is truthy in JS, which previously kept conditional fields
  // visible after the user selected "No".
  const reqs = (form.requirements ?? {}) as Record<string, unknown>;
  const setReq = (key: string, value: unknown) => update({ requirements: { ...reqs, [key]: value } });
  const isYes = (v: unknown, yesValue = "Required") => v === yesValue || v === "Yes";
  const loadersRequired = isYes(reqs.loaders_required);
  const videoRecording = isYes(reqs.video_recording, "Yes");
  const pianoRequired = isYes(reqs.piano_required);
  const cateringRequired = isYes(reqs.catering_required, "Yes");
  const decoratorRequired = isYes(reqs.decorator_required, "Yes");
  const liquorLicence = isYes(reqs.liquor_licence);

  const canSave = form.title.trim().length > 0 && !!form.organisation_id && !!form.venue_bookings[0]?.venue.trim();

  // In edit mode, wait for the existing event before rendering the form so the
  // user never sees an empty form for an event that already has data.
  if (isEdit && (existingLoading || !hydrated)) {
    return <div className="text-sm text-ink-muted">Loading…</div>;
  }

  return (
    <div>
      <PageHeader title={isEdit ? "Edit Event" : "New Event"} subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} />

      {/* Step indicator */}
      <div className="mb-6 flex gap-1.5">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            aria-current={i === step ? "step" : undefined}
            className={"flex min-h-10 flex-1 items-center justify-center rounded-full px-2 py-1.5 text-center text-xs font-medium leading-tight etched md:px-3 " + (i === step ? "bg-sage-btn text-sage-text carved-btn-sage" : i < step ? "bg-sage/10 text-sage-text" : "bg-marble-shadow/40 text-ink-muted")}
          >
            <span className="hidden lg:inline">{i + 1}. {label}</span>
            <span className="lg:hidden">{i + 1}. {STEP_SHORT_LABELS[i]}</span>
          </button>
        ))}
      </div>

      {error && <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-4 py-2 text-sm text-status-cancelled">{error}</div>}

      <FormNavigation
        step={step}
        setStep={setStep}
        canSave={canSave}
        isEdit={isEdit}
        isSaving={save.isPending}
        onSave={() => save.mutate()}
      />

      {/* Step 1: Event & Client — Organisation first (record anchor), then Event Name */}
      {step === 0 && (
        <div className="carved-card space-y-4 rounded-2xl bg-marble-highlight/50 p-6">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
            <Field label="Organisation Name *">
              <OrganisationCombobox
                value={form.organisation_id}
                onChange={(v) => update({ organisation_id: v })}
                onSelectOrganisation={(org) => {
                  setSelectedOrganisation(org);
                  setNewOrganisationType(org.org_type ?? "");
                }}
              />
            </Field>
            <Field label="Organisation Type">
              <select value={newOrganisationType} onChange={(e) => setNewOrganisationType(e.target.value)} className="carved input">
                <option value="">Select…</option>
                {ORG_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              {!form.organisation_id.startsWith("new:") && form.organisation_id && (
                <p className="mt-1 text-[11px] text-ink-muted etched">Existing organisation type shown for reference.</p>
              )}
            </Field>
          </div>
          <Field label="Event Name *">
            <input type="text" value={form.title} onChange={(e) => update({ title: e.target.value })} className="carved input" placeholder="e.g. Symphony Concert Series" />
          </Field>
          <Field label="Description">
            <textarea value={form.description ?? ""} onChange={(e) => update({ description: e.target.value || null })} className="carved input" rows={3} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Event Type">
              <select value={form.event_type ?? ""} onChange={(e) => update({ event_type: (e.target.value || null) as EventInputT["event_type"] })} className="carved input">
                <option value="">Select…</option>
                {EVENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {isVfh && <p className="mt-1 text-[11px] text-status-awaitingApproval etched">VFH selected — approval workflow will apply.</p>}
            </Field>
            <Field label="Enquiry Source">
              <select value={form.enquiry_source ?? ""} onChange={(e) => update({ enquiry_source: e.target.value || null })} className="carved input">
                <option value="">Select…</option>
                {sources.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
              </select>
            </Field>
            <Field label="Program Officer">
              <select value={form.program_officer ?? ""} onChange={(e) => update({ program_officer: e.target.value || null })} className="carved input">
                <option value="">Select…</option>
                {programOfficers.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
              </select>
            </Field>
            <Field label="Event Owner">
              <select
                value={form.event_owner_id ?? ""}
                onChange={(e) => {
                  const u = activeOwners.find((o) => o.id === e.target.value);
                  update({ event_owner_id: e.target.value || null, event_owner: u?.name ?? null });
                }}
                className="carved input"
              >
                <option value="">Select…</option>
                {activeOwners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              {form.event_owner && !form.event_owner_id && (
                <p className="mt-1 text-[11px] text-ink-muted etched">Legacy owner “{form.event_owner}” has no linked account — pick an owner above to link one.</p>
              )}
            </Field>
          </div>

          {/* Operating window — start/end on one row; end hidden for single-day events. */}
          <div>
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-sage etched">
              <input
                type="checkbox"
                checked={singleDay}
                onChange={(e) => {
                  const next = e.target.checked;
                  setSingleDay(next);
                  if (next) update({ event_end_date: null });
                }}
                className="h-3.5 w-3.5 rounded border-ink-muted"
              />
              Single-day event
            </label>
            <div className={"mt-2 grid gap-4 " + (singleDay ? "grid-cols-1" : "md:grid-cols-2")}>
              <Field label="Operating Window — Start Date">
                <input type="date" value={form.event_start_date ?? ""} onChange={(e) => update({ event_start_date: e.target.value || null })} className="carved input" />
              </Field>
              {!singleDay && (
                <Field label="Operating Window — End Date">
                  <input type="date" value={form.event_end_date ?? ""} onChange={(e) => update({ event_end_date: e.target.value || null })} className="carved input" />
                </Field>
              )}
            </div>
            {duplicateCheckReady && duplicates.length > 0 && (
              <div role="alert" className="mt-4 rounded-xl bg-status-awaitingApproval/10 px-4 py-3 text-status-awaitingApproval">
                <p className="text-sm font-semibold etched">Possible duplicate</p>
                <p className="mt-1 text-xs etched">
                  We found existing events with the same organisation, event name, and start date.
                </p>
                <div className="mt-3 space-y-2">
                  {duplicates.map((duplicate) => (
                    <div key={duplicate.id} className="rounded-lg bg-white/55 px-3 py-2 text-xs text-ink-primary">
                      <Link to={`/events/${duplicate.id}`} className="font-semibold text-ink-primary underline">
                        {duplicate.title}
                      </Link>
                      <div className="mt-1 text-ink-secondary etched">
                        {duplicate.organisation_name ?? "No organisation"} · {formatDate(duplicate.event_start_date)} · {duplicate.venues ?? "No venue"} · {duplicate.status}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <p className="text-[11px] text-ink-muted etched">
            The operating window is the full duration the organisation is at NCPA. Specific venue dates/AC timings are captured in Step 2.
          </p>
        </div>
      )}

      {/* Step 2: Venues & Schedule — AC timing captured per activity (with-AC + without-AC windows) */}
      {step === 1 && (
        <div className="space-y-4">
          {form.venue_bookings.map((vb, vIdx) => (
            <div key={vIdx} className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-primary etched-deep">Venue Booking {vIdx + 1}</h3>
                {form.venue_bookings.length > 1 && (
                  <button type="button" onClick={() => removeVenue(vIdx)} className="text-xs text-status-cancelled hover:underline">Remove</button>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Venue *">
                  <select value={vb.venue} onChange={(e) => updateVenue(vIdx, { venue: e.target.value })} className="carved input">
                    <option value="">Select…</option>
                    {venues.map((v) => <option key={v.value} value={v.value}>{v.value}</option>)}
                  </select>
                </Field>
                <Field label="Booking Status">
                  <select value={vb.booking_status} onChange={(e) => updateVenue(vIdx, { booking_status: e.target.value as VenueBookingInputT["booking_status"] })} className="carved input">
                    <option value="tentative">Tentative</option>
                    <option value="confirmed">Confirmed</option>
                  </select>
                </Field>
                <Field label="Number of Shows">
                  <input type="number" min={1} value={vb.number_of_shows} onChange={(e) => updateVenue(vIdx, { number_of_shows: Number(e.target.value) })} className="carved input" />
                </Field>
              </div>

              {/* Schedule entries — each carries With-AC and Without-AC windows (auto-durations). */}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-sage etched">Schedule Details</span>
                  <button type="button" onClick={() => addScheduleEntry(vIdx)} className="text-xs text-sage-text hover:underline">+ Add details</button>
                </div>
                <div className="space-y-3">
                  {vb.schedule_entries.map((se, sIdx) => {
                    const withMin = se.with_ac_minutes ?? diffMinutes(se.with_ac_start, se.with_ac_end);
                    const withoutMin = se.without_ac_minutes ?? diffMinutes(se.without_ac_start, se.without_ac_end);
                    const total = (withMin ?? 0) + (withoutMin ?? 0);
                    return (
                      <div key={sIdx} className="rounded-xl bg-marble-shadow/30 p-3">
                        <div className="mb-2 grid grid-cols-2 items-end gap-2 md:grid-cols-4">
                          <Field label="Activity">
                            <select value={se.activity_type} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { activity_type: e.target.value as ScheduleEntryInputT["activity_type"] })} className="carved input">
                              {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
                            </select>
                          </Field>
                          <Field label="Date">
                            <input type="date" value={se.activity_date} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { activity_date: e.target.value })} className="carved input" />
                          </Field>
                          <Field label="Activity Start">
                            <input type="time" value={se.start_time ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { start_time: e.target.value || null })} className="carved input" />
                          </Field>
                          <Field label="Activity End">
                            <input type="time" value={se.end_time ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { end_time: e.target.value || null })} className="carved input" />
                          </Field>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg bg-marble-highlight/50 p-2">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sage etched">With AC</div>
                            <div className="grid grid-cols-3 items-end gap-2">
                              <Field label="Start"><input type="time" value={se.with_ac_start ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { with_ac_start: e.target.value || null })} className="carved input" /></Field>
                              <Field label="End"><input type="time" value={se.with_ac_end ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { with_ac_end: e.target.value || null })} className="carved input" /></Field>
                              <Field label="Duration"><input readOnly value={formatDuration(withMin)} className="carved input bg-transparent" /></Field>
                            </div>
                          </div>
                          <div className="rounded-lg bg-marble-highlight/50 p-2">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sage etched">Without AC</div>
                            <div className="grid grid-cols-3 items-end gap-2">
                              <Field label="Start"><input type="time" value={se.without_ac_start ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { without_ac_start: e.target.value || null })} className="carved input" /></Field>
                              <Field label="End"><input type="time" value={se.without_ac_end ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { without_ac_end: e.target.value || null })} className="carved input" /></Field>
                              <Field label="Duration"><input readOnly value={formatDuration(withoutMin)} className="carved input bg-transparent" /></Field>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-muted etched">
                          <span>Hall rental for this date = Without AC + With AC = <strong className="text-sage-text">{formatDuration(total)}</strong></span>
                          <button type="button" onClick={() => removeScheduleEntry(vIdx, sIdx)} className="text-status-cancelled hover:underline">Remove</button>
                        </div>
                      </div>
                    );
                  })}
                  {vb.schedule_entries.length === 0 && <p className="text-xs text-ink-muted etched">No details yet. Add setup, rehearsal, show, dismantling, or technical meeting with their AC timings.</p>}
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addVenue} className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched">+ Add venue</button>
        </div>
      )}

      {/* Step 3: Requirements */}
      {step === 2 && (
        <div className="space-y-4">
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Sound</h3>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
              <Field label="Sound Requirements">
                <textarea value={(reqs.sound as string) ?? ""} onChange={(e) => setReq("sound", e.target.value || null)} className="carved input" rows={2} />
              </Field>
              <Field label="Sound Call Time">
                <input type="time" value={(reqs.sound_call_time as string) ?? ""} onChange={(e) => setReq("sound_call_time", e.target.value || null)} className="carved input" />
              </Field>
            </div>
          </section>
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Light</h3>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
              <Field label="Light Requirements">
                <textarea value={(reqs.light as string) ?? ""} onChange={(e) => setReq("light", e.target.value || null)} className="carved input" rows={2} />
              </Field>
              <Field label="Light Call Time">
                <input type="time" value={(reqs.light_call_time as string) ?? ""} onChange={(e) => setReq("light_call_time", e.target.value || null)} className="carved input" />
              </Field>
            </div>
          </section>
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Staffing & Facilities</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Green Rooms Required">
                <YesNoSelect value={(reqs.green_rooms_required as string) ?? ""} onChange={(v) => setReq("green_rooms_required", v || null)} />
              </Field>
              <Field label="Green Room Amenities">
                <textarea value={(reqs.green_room_amenities as string) ?? ""} onChange={(e) => setReq("green_room_amenities", e.target.value || null)} className="carved input" rows={1} />
              </Field>
              <Field label="Ushers Required">
                <YesNoSelect value={(reqs.ushers_required as string) ?? ""} onChange={(v) => setReq("ushers_required", v || null)} />
              </Field>
              <Field label="Ushers Call Time">
                <input type="time" value={(reqs.ushers_call_time as string) ?? ""} onChange={(e) => setReq("ushers_call_time", e.target.value || null)} className="carved input" />
              </Field>
              <Field label="Loaders Required">
                <YesNoSelect value={(reqs.loaders_required as string) ?? ""} onChange={(v) => setReq("loaders_required", v || null)} />
              </Field>
              {loadersRequired && (
                <Field label="Loaders Call Time (conditional)">
                  <input type="time" value={(reqs.loaders_call_time as string) ?? ""} onChange={(e) => setReq("loaders_call_time", e.target.value || null)} className="carved input" />
                </Field>
              )}
              <Field label="House Seats Release">
                <YesNoSelect value={(reqs.house_seats_release as string) ?? ""} onChange={(v) => setReq("house_seats_release", v || null)} yesValue="Yes" noValue="No" />
              </Field>
              <Field label="House Tickets">
                <select value={(reqs.house_tickets as string) ?? ""} onChange={(e) => setReq("house_tickets", e.target.value || null)} className="carved input">
                  <option value="">Select…</option>
                  <option value="Client pass">Client pass</option>
                  <option value="NCPA pass">NCPA pass</option>
                </select>
              </Field>
            </div>
          </section>
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Recording & Special</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Video Recording">
                <YesNoSelect value={(reqs.video_recording as string) ?? ""} onChange={(v) => setReq("video_recording", v || null)} yesValue="Yes" noValue="No" />
              </Field>
              {videoRecording && (
                <>
                  <Field label="No. of Cameras (conditional)">
                    <input type="number" min={0} value={(reqs.camera_count as string) ?? ""} onChange={(e) => setReq("camera_count", e.target.value || null)} className="carved input" />
                  </Field>
                  <Field label="Recording Type (conditional)">
                    <select value={(reqs.recording_type as string) ?? ""} onChange={(e) => setReq("recording_type", e.target.value || null)} className="carved input">
                      <option value="">Select…</option>
                      <option value="Archival">Archival</option>
                      <option value="Broadcast">Broadcast (chargeable)</option>
                    </select>
                  </Field>
                </>
              )}
              <Field label="Piano Required">
                <YesNoSelect value={(reqs.piano_required as string) ?? ""} onChange={(v) => setReq("piano_required", v || null)} yesValue="Yes" noValue="No" />
              </Field>
              {pianoRequired && (
                <Field label="Piano Tuning Time (conditional)">
                  <input type="time" value={(reqs.piano_tuning_time as string) ?? ""} onChange={(e) => setReq("piano_tuning_time", e.target.value || null)} className="carved input" />
                </Field>
              )}
              <Field label="Liquor Licence">
                <select value={(reqs.liquor_licence as string) ?? ""} onChange={(e) => setReq("liquor_licence", e.target.value || null)} className="carved input">
                  <option value="">Select…</option>
                  <option value="Not Required">Not Required</option>
                  <option value="Required">Required</option>
                </select>
              </Field>
              {liquorLicence && (
                <Field label="Liquor Licence Details (conditional)">
                  <input type="text" value={(reqs.liquor_licence_details as string) ?? ""} onChange={(e) => setReq("liquor_licence_details", e.target.value || null)} className="carved input" />
                </Field>
              )}
            </div>
          </section>
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Catering / Decorator</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Catering Required">
                <YesNoSelect value={(reqs.catering_required as string) ?? ""} onChange={(v) => setReq("catering_required", v || null)} yesValue="Yes" noValue="No" />
              </Field>
              {cateringRequired && (
                <>
                  <Field label="Caterer (conditional)">
                    <select value={(reqs.catering_provider as string) ?? ""} onChange={(e) => setReq("catering_provider", e.target.value || null)} className="carved input">
                      <option value="">Select…</option>
                      {(lookups?.lookups.caterer ?? []).map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                    </select>
                  </Field>
                  <Field label="No. of Pax (conditional)">
                    <input type="number" min={0} value={(reqs.no_of_pax as string) ?? ""} onChange={(e) => setReq("no_of_pax", e.target.value || null)} className="carved input" />
                  </Field>
                </>
              )}
              <Field label="Decorator">
                <YesNoSelect value={(reqs.decorator_required as string) ?? ""} onChange={(v) => setReq("decorator_required", v || null)} yesValue="Yes" noValue="No" />
              </Field>
              {decoratorRequired && (
                <Field label="Decorator Name (conditional)">
                  <select value={(reqs.decorator_name as string) ?? ""} onChange={(e) => setReq("decorator_name", e.target.value || null)} className="carved input">
                    <option value="">Select…</option>
                    {(lookups?.lookups.decorator ?? []).map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                  </select>
                </Field>
              )}
            </div>
          </section>
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Operations</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Parking Requirements">
                <textarea value={(reqs.parking as string) ?? ""} onChange={(e) => setReq("parking", e.target.value || null)} className="carved input" rows={1} />
              </Field>
              <Field label="Security Notes">
                <textarea value={(reqs.security as string) ?? ""} onChange={(e) => setReq("security", e.target.value || null)} className="carved input" rows={1} />
              </Field>
              <Field label="Housekeeping">
                <textarea value={(reqs.housekeeping as string) ?? ""} onChange={(e) => setReq("housekeeping", e.target.value || null)} className="carved input" rows={1} />
              </Field>
              <Field label="No. of Crew Cards">
                <input type="number" min={0} value={(reqs.crew_cards as string) ?? ""} onChange={(e) => setReq("crew_cards", e.target.value || null)} className="carved input" />
              </Field>
              <Field label="Licenses (PPL/IPRS etc.)">
                <textarea value={(reqs.licenses as string) ?? ""} onChange={(e) => setReq("licenses", e.target.value || null)} className="carved input" rows={1} />
              </Field>
            </div>
          </section>
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Additional Requirements</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Field label="Orchestra Pit Chairs">
                  <YesNoSelect value={(reqs.orchestra_pit_chairs as string) ?? ""} onChange={(v) => setReq("orchestra_pit_chairs", v || null)} yesValue="Keep" noValue="Remove" />
                </Field>
                {isYes(reqs.orchestra_pit_chairs, "Keep") && (
                  <Field label="Orchestra Pit Chairs — note (qty)">
                    <input type="text" value={(reqs.orchestra_pit_chairs_note as string) ?? ""} onChange={(e) => setReq("orchestra_pit_chairs_note", e.target.value || null)} className="carved input" />
                  </Field>
                )}
              </div>
              <div className="space-y-2">
                <Field label="Digital Standee">
                  <YesNoSelect value={(reqs.digital_standee as string) ?? ""} onChange={(v) => setReq("digital_standee", v || null)} yesValue="Yes" noValue="No" />
                </Field>
                {isYes(reqs.digital_standee, "Yes") && (
                  <Field label="Digital Standee — note">
                    <input type="text" value={(reqs.digital_standee_note as string) ?? ""} onChange={(e) => setReq("digital_standee_note", e.target.value || null)} className="carved input" />
                  </Field>
                )}
              </div>
              <div className="space-y-2">
                <Field label="Car Display">
                  <YesNoSelect value={(reqs.car_display as string) ?? ""} onChange={(v) => setReq("car_display", v || null)} yesValue="Yes" noValue="No" />
                </Field>
                {isYes(reqs.car_display, "Yes") && (
                  <Field label="Car Display — note">
                    <input type="text" value={(reqs.car_display_note as string) ?? ""} onChange={(e) => setReq("car_display_note", e.target.value || null)} className="carved input" />
                  </Field>
                )}
              </div>
              <div className="space-y-2">
                <Field label="Bike Display">
                  <YesNoSelect value={(reqs.bike_display as string) ?? ""} onChange={(v) => setReq("bike_display", v || null)} yesValue="Yes" noValue="No" />
                </Field>
                {isYes(reqs.bike_display, "Yes") && (
                  <Field label="Bike Display — note">
                    <input type="text" value={(reqs.bike_display_note as string) ?? ""} onChange={(e) => setReq("bike_display_note", e.target.value || null)} className="carved input" />
                  </Field>
                )}
              </div>
              <div className="space-y-2">
                <Field label="Stalls">
                  <YesNoSelect value={(reqs.stalls as string) ?? ""} onChange={(v) => setReq("stalls", v || null)} yesValue="Yes" noValue="No" />
                </Field>
                {isYes(reqs.stalls, "Yes") && (
                  <Field label="Stalls — note (no. of stalls)">
                    <input type="text" value={(reqs.stalls_note as string) ?? ""} onChange={(e) => setReq("stalls_note", e.target.value || null)} className="carved input" />
                  </Field>
                )}
              </div>
              <div className="space-y-2">
                <Field label="Telecasting / Media">
                  <YesNoSelect value={(reqs.telecasting_media as string) ?? ""} onChange={(v) => setReq("telecasting_media", v || null)} yesValue="Yes" noValue="No" />
                </Field>
                {isYes(reqs.telecasting_media, "Yes") && (
                  <Field label="Telecasting / Media — note">
                    <input type="text" value={(reqs.telecasting_media_note as string) ?? ""} onChange={(e) => setReq("telecasting_media_note", e.target.value || null)} className="carved input" />
                  </Field>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Step 4: Documents — placeholder */}
      {step === 3 && (
        <div className="carved-card rounded-2xl bg-marble-highlight/50 p-8 text-center">
          <p className="text-sm text-ink-secondary etched">Document uploads are added after the event is created (Phase 7 — R2 storage).</p>
          <p className="mt-2 text-xs text-ink-muted etched">You can continue to review and save the event now.</p>
        </div>
      )}

      {/* Step 5: Review */}
      {step === 4 && (
        <div className="carved-card space-y-4 rounded-2xl bg-marble-highlight/50 p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-sage etched">Review</h3>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            {reviewItems.map((item) => (
              <ReviewItem key={`${item.label}:${item.value}`} label={item.label} value={item.value} />
            ))}
          </dl>
          <Field label="Notes">
            <textarea value={form.notes ?? ""} onChange={(e) => update({ notes: e.target.value || null })} className="carved input" rows={2} placeholder="Event-level notes…" />
          </Field>
        </div>
      )}

      <FormNavigation
        step={step}
        setStep={setStep}
        canSave={canSave}
        isEdit={isEdit}
        isSaving={save.isPending}
        onSave={() => save.mutate()}
        className="mt-6"
      />
    </div>
  );
}

/** Organisation combobox — searches existing orgs by prefix; offers "Create new" when no match. */
function OrganisationCombobox({
  value,
  onChange,
  onSelectOrganisation,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelectOrganisation: (org: OrgListItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // Decode the current value into a display string.
  const displayName = useMemo(() => {
    if (!value) return "";
    if (value.startsWith("new:")) return value.slice(4);
    return value; // existing id — resolved to a name below
  }, [value]);

  const { data } = useQuery<{ organisations: OrgListItem[] }>({
    queryKey: ["org-search", query],
    queryFn: () => apiGet(`/organisations?q=${encodeURIComponent(query)}`),
    enabled: open && query.length > 0,
    staleTime: 10_000,
  });

  // Resolve an existing org id → { name, org_type } so the field shows the
  // organisation's name (not its raw id) immediately on edit, before the user
  // interacts with the combobox. Fires on mount whenever a real id is present.
  const isExistingId = !!value && !value.startsWith("new:");
  const { data: resolvedOrg } = useQuery<{ organisation: OrgListItem }>({
    queryKey: ["organisation", value],
    queryFn: () => apiGet(`/organisations/${value}`),
    enabled: isExistingId,
  });

  // Once we know the org's type, push it up so the form's "Organisation Type"
  // field reflects the saved value (mirrors selecting from the dropdown).
  // Deliberately only keyed on resolvedOrg — this is a one-shot hydration that
  // must not refire on every parent re-render.
  useEffect(() => {
    if (resolvedOrg?.organisation) onSelectOrganisation(resolvedOrg.organisation);
  }, [resolvedOrg, onSelectOrganisation]);

  const results = data?.organisations ?? [];
  const inputText = query || resolvedOrg?.organisation?.name || displayName;

  return (
    <div className="relative">
      <input
        type="text"
        value={inputText}
        placeholder="Start typing the organisation name…"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(""); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="carved input"
      />
      {open && (query || !value) && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl bg-marble-highlight shadow-lg">
          {results.length > 0 ? (
            results.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(o.id); onSelectOrganisation(o); setQuery(o.name); setOpen(false); }}
                className="block w-full px-4 py-2 text-left text-sm text-ink-primary hover:bg-marble-shadow/40"
              >
                {o.name}
              </button>
            ))
          ) : (
            query.trim().length > 0 && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(`new:${query.trim()}`); setQuery(query.trim()); setOpen(false); }}
                className="block w-full px-4 py-2 text-left text-sm text-sage-text hover:bg-marble-shadow/40"
              >
                + Create new: “{query.trim()}”
              </button>
            )
          )}
          {query.trim().length === 0 && results.length === 0 && (
            <div className="px-4 py-2 text-xs text-ink-muted etched">Type to search existing organisations.</div>
          )}
        </div>
      )}
    </div>
  );
}

function FormNavigation({
  step,
  setStep,
  canSave,
  isEdit,
  isSaving,
  onSave,
  className = "mb-5",
}: {
  step: number;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  canSave: boolean;
  isEdit: boolean;
  isSaving: boolean;
  onSave: () => void;
  className?: string;
}) {
  return (
    <div className={"flex justify-between " + className}>
      <button
        type="button"
        onClick={() => setStep((s) => Math.max(0, s - 1))}
        disabled={step === 0}
        className="carved-btn rounded-full bg-neutral-btn px-5 py-2 text-sm font-medium text-ink-secondary etched disabled:opacity-40"
      >
        Back
      </button>
      {step < STEPS.length - 1 ? (
        <button
          type="button"
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched"
        >
          Next
        </button>
      ) : (
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !canSave}
          className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
        >
          {isSaving ? "Saving..." : isEdit ? "Save changes" : "Create event"}
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-sage etched">{label}</span>
      {children}
    </label>
  );
}

function YesNoSelect({ value, onChange, yesValue = "Required", noValue = "Not Required" }: { value: string; onChange: (v: string) => void; yesValue?: string; noValue?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="carved input">
      <option value="">Select…</option>
      <option value={noValue}>{noValue}</option>
      <option value={yesValue}>{yesValue}</option>
    </select>
  );
}

function ReviewItem({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex justify-between border-b border-ink-muted/10 pb-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink-primary etched-deep">{String(value ?? "—")}</dd>
    </div>
  );
}
