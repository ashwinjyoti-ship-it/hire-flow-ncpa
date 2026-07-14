import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { RequirementsFields } from "../components/event-form/RequirementsFields";
import { PocFields } from "../components/event-form/PocFields";
import { apiGet, apiPost, apiPut } from "../lib/api";
import {
  buildEventRequirementsPayload,
  canCreateEvent,
  getEventFormDateError,
  getScheduleValidationError,
  hydrateVenueRequirements,
  organisationValueFromName,
  parseRequirements,
  pickEventLevelRequirements,
  pruneEmptyVenueBookings,
} from "../lib/event-edit-form";
import { buildReviewItems } from "../lib/event-review";
import { useLookups, formatDate, formatDuration } from "../lib/use-lookups";
import { ORG_TYPES } from "../components/orgs/types";
import type { EventInputT, VenueBookingInputT, ScheduleEntryInputT } from "../../worker/lib/types";
import { ACTIVITY_TYPES, formatActivityType } from "../../worker/lib/types";

const STEPS = ["Event & Client", "Venues & Schedule", "Requirements", "Documents", "Review"] as const;
const STEP_SHORT_LABELS = ["Client", "Schedule", "Requirements", "Documents", "Review"] as const;
const EVENT_TYPE_OPTIONS = [
  { value: "EE", label: "EE" },
  { value: "FR", label: "FR (Foundation)" },
  { value: "VFH", label: "VFH (Venue For Hire)" },
  { value: "Free Event", label: "Free Event" },
] as const;

type OrgListItem = { id: string; name: string; org_type: string | null };
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
  const [requirementsVenueTab, setRequirementsVenueTab] = useState(0);

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
    const eventReqs = parseRequirements(e.requirements);
    const bookingsRaw: VenueBookingInputT[] = existing.venue_bookings?.length
      ? existing.venue_bookings.map((vb) => ({
          id: vb.id,
          venue: vb.venue ?? "",
          booking_status: (vb.booking_status === "confirmed" ? "confirmed" : "tentative") as VenueBookingInputT["booking_status"],
          number_of_shows: vb.number_of_shows ?? 1,
          requirements: parseRequirements(vb.requirements),
          notes: vb.notes ?? null,
          schedule_entries: (vb.schedule_entries ?? []).map((se) => ({
            id: se.id,
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
    // Legacy events stored requirements only on the event — seed each empty venue booking.
    const bookings = hydrateVenueRequirements(bookingsRaw, eventReqs);

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
      requirements: pickEventLevelRequirements(eventReqs),
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
      const venueBookings = pruneEmptyVenueBookings(form.venue_bookings);
      const incompleteSchedule = getScheduleValidationError(venueBookings);
      if (incompleteSchedule) throw new Error(incompleteSchedule);
      const requirements = buildEventRequirementsPayload(venueBookings, form.requirements);
      const payload = {
        ...form,
        organisation_id: orgId,
        event_end_date: singleDay ? null : form.event_end_date,
        requirements: Object.keys(requirements).length > 0 ? requirements : null,
        venue_bookings: venueBookings,
      };
      if (isEdit && id) {
        await apiPut(`/events/${id}`, payload);
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
  const selectedDuplicateVenues = useMemo(
    () => Array.from(new Set(pruneEmptyVenueBookings(form.venue_bookings).map((booking) => booking.venue.trim()).filter(Boolean))),
    [form.venue_bookings],
  );
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
    ...(selectedDuplicateVenues.length > 0 ? { venues: selectedDuplicateVenues.join("|") } : {}),
    ...(id ? { exclude: id } : {}),
  });
  const { data: duplicateData } = useQuery<DuplicateCheckResponse>({
    queryKey: ["event-duplicates", form.organisation_id, trimmedTitle, form.event_start_date ?? "", selectedDuplicateVenues.join("|"), id ?? ""],
    queryFn: () => apiGet<DuplicateCheckResponse>(`/events/duplicates?${duplicateQuery.toString()}`),
    enabled: duplicateCheckReady,
    staleTime: 10_000,
  });
  const duplicates = duplicateData?.duplicates ?? [];
  const hasDuplicateWarning = duplicates.length > 0;
  const dateError = getEventFormDateError({
    event_start_date: form.event_start_date,
    event_end_date: singleDay ? null : form.event_end_date,
    venue_bookings: pruneEmptyVenueBookings(form.venue_bookings),
  });
  const scheduleError = getScheduleValidationError(pruneEmptyVenueBookings(form.venue_bookings));
  const reviewOrganisationName = useMemo(() => {
    if (form.organisation_id.startsWith("new:")) return form.organisation_id.slice(4);
    return selectedOrganisation?.name ?? null;
  }, [form.organisation_id, selectedOrganisation]);
  const reviewItems = useMemo(() => buildReviewItems(form, reviewOrganisationName, {
    organisationType: newOrganisationType,
    isVfh,
  }), [form, reviewOrganisationName, newOrganisationType, isVfh]);

  // ---- Venue booking helpers ----
  // Schedule helpers use functional setState so rapid AC time edits (and
  // multi-venue updates) never overwrite each other via a stale form closure.
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
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => {
        if (i !== vIdx) return vb;
        return {
          ...vb,
          schedule_entries: [...(vb.schedule_entries ?? []), {
            activity_type: "show" as const,
            activity_date: f.event_start_date ?? "",
            start_time: null,
            end_time: null,
            with_ac_start: null,
            with_ac_end: null,
            with_ac_minutes: null,
            without_ac_start: null,
            without_ac_end: null,
            without_ac_minutes: null,
            notes: null,
          }],
        };
      }),
    }));
  const removeScheduleEntry = (vIdx: number, sIdx: number) =>
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => (
        i === vIdx
          ? { ...vb, schedule_entries: (vb.schedule_entries ?? []).filter((_, j) => j !== sIdx) }
          : vb
      )),
    }));
  const updateScheduleEntry = (vIdx: number, sIdx: number, patch: Partial<ScheduleEntryInputT>) =>
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => {
        if (i !== vIdx) return vb;
        return {
          ...vb,
          schedule_entries: (vb.schedule_entries ?? []).map((se, j) => {
            if (j !== sIdx) return se;
            const merged = { ...se, ...patch };
            // Auto-recompute AC durations whenever their start/end changes.
            const withMin = diffMinutes(merged.with_ac_start, merged.with_ac_end);
            const withoutMin = diffMinutes(merged.without_ac_start, merged.without_ac_end);
            return { ...merged, with_ac_minutes: withMin, without_ac_minutes: withoutMin };
          }),
        };
      }),
    }));

  // Event-level requirements only (program officer contact). Venue fields live on each booking.
  const reqs = (form.requirements ?? {}) as Record<string, unknown>;
  const setReq = (key: string, value: unknown) => update({ requirements: { ...reqs, [key]: value } });
  const venueCount = form.venue_bookings.length;
  const activeRequirementsVenue = Math.min(requirementsVenueTab, Math.max(0, venueCount - 1));
  const updateVenueRequirements = (vIdx: number, next: Record<string, unknown>) => {
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => (i === vIdx ? { ...vb, requirements: next } : vb)),
    }));
  };

  const canSave = canCreateEvent(form) && !hasDuplicateWarning && !dateError && !scheduleError;

  // In edit mode, wait for the existing event before rendering the form so the
  // user never sees an empty form for an event that already has data.
  if (isEdit && (existingLoading || !hydrated)) {
    return <div className="text-sm text-ink-muted">Loading…</div>;
  }

  return (
    <div>
      <PageHeader title={isEdit ? "Edit Event" : "New Event"} subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} />

      {dateError && (
        <p role="alert" className="mb-4 rounded-xl bg-status-cancelled/10 px-3 py-2 text-xs font-medium text-status-cancelled">
          {dateError}
        </p>
      )}
      {scheduleError && (
        <p role="alert" className="mb-4 rounded-xl bg-status-cancelled/10 px-3 py-2 text-xs font-medium text-status-cancelled">
          {scheduleError}
        </p>
      )}

      {/* Step indicator */}
      <div className="mb-6 flex gap-1.5">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            aria-current={i === step ? "step" : undefined}
            className={"flex min-h-10 flex-1 items-center justify-center rounded-full px-2 py-1.5 text-center text-xs font-medium leading-tight etched md:px-3 " + (i === step ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta" : i < step ? "bg-sage/10 text-sage-text" : "bg-marble-shadow/40 text-ink-muted")}
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
          {/* Operating window — start date is the core required date for a new event. */}
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
                <input type="date" lang="en-GB" value={form.event_start_date ?? ""} onChange={(e) => update({ event_start_date: e.target.value || null })} className="carved input" />
              </Field>
              {!singleDay && (
                <Field label="Operating Window — End Date">
                  <input type="date" lang="en-GB" value={form.event_end_date ?? ""} onChange={(e) => update({ event_end_date: e.target.value || null })} className="carved input" />
                </Field>
              )}
            </div>
            {duplicateCheckReady && duplicates.length > 0 && (
              <div role="alert" className="mt-4 rounded-xl bg-status-awaitingApproval/10 px-4 py-3 text-status-awaitingApproval">
                <p className="text-sm font-semibold etched">Possible duplicate</p>
                <p className="mt-1 text-xs etched">
                  We found existing events with the same organisation and start date, with either the same event name or one of the same venues.
                </p>
                <p className="mt-1 text-xs font-medium etched">Saving is disabled until you change the event details or open the existing record.</p>
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
            <Field label="Program Officer Contact">
              <input
                type="tel"
                value={(reqs.program_officer_phone as string) ?? ""}
                onChange={(e) => setReq("program_officer_phone", e.target.value || null)}
                className="carved input"
                placeholder="e.g. 022 66223822 or +91 9137076369"
              />
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

          <PocFields value={reqs} onChange={(next) => update({ requirements: next })} />

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
                              {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{formatActivityType(a)}</option>)}
                            </select>
                          </Field>
                          <Field label="Date">
                            <input type="date" lang="en-GB" value={se.activity_date} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { activity_date: e.target.value })} className="carved input" />
                          </Field>
                          <Field label="Activity Start">
                            <input type="time" lang="en-GB" value={se.start_time ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { start_time: e.target.value || null })} className="carved input" />
                          </Field>
                          <Field label="Activity End">
                            <input type="time" lang="en-GB" value={se.end_time ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { end_time: e.target.value || null })} className="carved input" />
                          </Field>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg bg-marble-highlight/50 p-2">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sage etched">With AC</div>
                            <div className="grid grid-cols-3 items-end gap-2">
                              <Field label="Start"><input type="time" lang="en-GB" value={se.with_ac_start ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { with_ac_start: e.target.value || null })} className="carved input" /></Field>
                              <Field label="End"><input type="time" lang="en-GB" value={se.with_ac_end ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { with_ac_end: e.target.value || null })} className="carved input" /></Field>
                              <Field label="Duration"><input readOnly value={formatDuration(withMin)} className="carved input bg-transparent" /></Field>
                            </div>
                          </div>
                          <div className="rounded-lg bg-marble-highlight/50 p-2">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sage etched">Without AC</div>
                            <div className="grid grid-cols-3 items-end gap-2">
                              <Field label="Start"><input type="time" lang="en-GB" value={se.without_ac_start ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { without_ac_start: e.target.value || null })} className="carved input" /></Field>
                              <Field label="End"><input type="time" lang="en-GB" value={se.without_ac_end ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { without_ac_end: e.target.value || null })} className="carved input" /></Field>
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
                  {vb.schedule_entries.length === 0 && <p className="text-xs text-ink-muted etched">No details yet. Add setup, rehearsal, show, dismantling, or zero show with their AC timings.</p>}
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addVenue} className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched">+ Add venue</button>
        </div>
      )}

      {/* Step 3: Requirements — one form per venue booking */}
      {step === 2 && (
        <div className="space-y-4">
          {venueCount === 0 ? (
            <div className="carved-card rounded-2xl bg-marble-highlight/50 p-8 text-center">
              <p className="text-sm text-ink-secondary etched">Add a venue in the previous step before entering requirements.</p>
            </div>
          ) : (
            <>
              {venueCount > 1 && (
                <div className="flex flex-wrap gap-2">
                  {form.venue_bookings.map((vb, idx) => (
                    <button
                      key={vb.id ?? `venue-req-${idx}`}
                      type="button"
                      onClick={() => setRequirementsVenueTab(idx)}
                      aria-current={idx === activeRequirementsVenue ? "true" : undefined}
                      className={
                        "rounded-full px-4 py-2 text-xs font-semibold etched "
                        + (idx === activeRequirementsVenue
                          ? "bg-terracotta-btn text-terracotta-text carved-btn-terracotta"
                          : "bg-marble-shadow/40 text-ink-secondary")
                      }
                    >
                      {vb.venue?.trim() || `Venue ${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}
              {venueCount > 1 && (
                <p className="text-xs text-ink-muted etched">
                  Requirements for {form.venue_bookings[activeRequirementsVenue]?.venue?.trim() || `Venue ${activeRequirementsVenue + 1}`}
                </p>
              )}
              <RequirementsFields
                value={(form.venue_bookings[activeRequirementsVenue]?.requirements ?? {}) as Record<string, unknown>}
                onChange={(next) => updateVenueRequirements(activeRequirementsVenue, next)}
              />
            </>
          )}
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

/** Organisation combobox — free text creates a new org; suggestions only select existing orgs. */
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
  const hydratedOrgIdRef = useRef<string | null>(null);

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
  useEffect(() => {
    const org = resolvedOrg?.organisation;
    if (!org || hydratedOrgIdRef.current === org.id) return;
    hydratedOrgIdRef.current = org.id;
    onSelectOrganisation(org);
  }, [resolvedOrg?.organisation?.id, onSelectOrganisation]);

  useEffect(() => {
    if (!isExistingId) hydratedOrgIdRef.current = null;
  }, [isExistingId, value]);

  const results = data?.organisations ?? [];
  const inputText = query || resolvedOrg?.organisation?.name || displayName;

  return (
    <div className="relative">
      <input
        type="text"
        value={inputText}
        placeholder="Start typing the organisation name…"
        onChange={(e) => {
          const nextName = e.target.value;
          setQuery(nextName);
          setOpen(true);
          onChange(organisationValueFromName(nextName));
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="carved input"
      />
      {open && query.trim().length > 0 && results.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl bg-marble-highlight shadow-lg">
          {results.map((o) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o.id);
                onSelectOrganisation(o);
                setQuery(o.name);
                setOpen(false);
              }}
              className="block w-full px-4 py-2 text-left text-sm text-ink-primary hover:bg-marble-shadow/40"
            >
              {o.name}
            </button>
          ))}
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
          className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
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

function ReviewItem({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex min-h-24 h-full flex-col items-center justify-center rounded-xl border border-ink-muted/10 bg-white/35 px-4 py-3 text-center">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="mt-2 w-full max-w-full whitespace-normal break-words text-center font-medium leading-relaxed text-ink-primary etched-deep">{String(value ?? "—")}</dd>
    </div>
  );
}
