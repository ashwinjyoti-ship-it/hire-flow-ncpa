import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { RequirementsFields } from "../components/event-form/RequirementsFields";
import { PocFields } from "../components/event-form/PocFields";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { scrollAppMainToElement } from "../lib/scroll-app-main";
import {
  buildEventRequirementsPayload,
  canCreateEvent,
  createDefaultEventLevelRequirements,
  createDefaultVenueRequirements,
  getEventFormDateError,
  hydrateVenueRequirements,
  organisationValueFromName,
  parseRequirements,
  pickEventLevelRequirements,
  prepareVenueBookingsForSave,
  pruneEmptyVenueBookings,
  withDefaultEventLevelRequirements,
  withDefaultVenueRequirements,
} from "../lib/event-edit-form";
import { buildReviewItems } from "../lib/event-review";
import { useLookups, formatDate, formatDuration } from "../lib/use-lookups";
import { formatHoursTotal, sumTimingMinutesFromVenueBookings } from "../../worker/lib/timing-sync";
import { countScheduledShowsByDate, deriveVenueShowCount } from "../../worker/lib/show-schedule";
import { deriveScheduleDaysFromEntries } from "../../worker/lib/schedule-days";
import { ORG_TYPES } from "../components/orgs/types";
import type { EventInputT, VenueBookingInputT, ScheduleDayInputT, ScheduleEntryInputT } from "../../worker/lib/types";
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
    schedule_days?: ScheduleDayInputT[];
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

function nextAvailableScheduleDate(startDate: string | null | undefined, usedDates: Set<string>): string {
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(startDate ?? "") ? startDate! : new Date().toISOString().slice(0, 10);
  const date = new Date(`${candidate}T00:00:00.000Z`);
  while (usedDates.has(date.toISOString().slice(0, 10))) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function hydrateEventFormFromDetail(existing: EventDetailResponse): { form: EventInputT; singleDay: boolean } {
  const e = existing.event;
  const eventReqs = parseRequirements(e.requirements);
  const bookingsRaw: VenueBookingInputT[] = existing.venue_bookings?.length
    ? existing.venue_bookings.map((vb) => {
      const scheduleEntries: ScheduleEntryInputT[] = (vb.schedule_entries ?? []).map((se) => ({
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
      }));
      return {
        id: vb.id,
        venue: vb.venue ?? "",
        booking_status: (vb.booking_status === "confirmed" ? "confirmed" : "tentative") as VenueBookingInputT["booking_status"],
        number_of_shows: vb.number_of_shows ?? 1,
        requirements: withDefaultVenueRequirements(parseRequirements(vb.requirements)),
        notes: vb.notes ?? null,
        schedule_days: vb.schedule_days?.length ? vb.schedule_days : deriveScheduleDaysFromEntries(scheduleEntries),
        schedule_entries: scheduleEntries,
      };
    })
    : [{ venue: "", booking_status: "tentative", number_of_shows: 0, requirements: createDefaultVenueRequirements(), notes: null, schedule_days: [], schedule_entries: [] }];
  const bookings = hydrateVenueRequirements(bookingsRaw, eventReqs).map((booking) => ({
    ...booking,
    requirements: withDefaultVenueRequirements(booking.requirements as Record<string, unknown> | null),
  }));

  return {
    form: {
      title: e.title ?? "",
      description: e.description ?? null,
      organisation_id: e.organisation_id ?? "",
      primary_contact_id: e.primary_contact_id ?? null,
      event_type: normaliseEventType(e.event_type),
      program_officer: e.program_officer ?? null,
      event_owner: e.event_owner ?? null,
      event_owner_id: e.event_owner_id ?? null,
      event_start_date: e.event_start_date ?? null,
      event_end_date: e.event_end_date ?? null,
      enquiry_source: e.enquiry_source ?? null,
      priority: e.priority ?? "medium",
      requirements: withDefaultEventLevelRequirements(pickEventLevelRequirements(eventReqs)),
      notes: e.notes ?? null,
      venue_bookings: bookings,
    },
    singleDay: !e.event_end_date,
  };
}

// (formatDuration is imported from lib/use-lookups for consistent hh/d rendering)

type SaveOptions = { navigateAfter?: boolean };

export function EventEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { data: lookups } = useLookups();
  const isEdit = Boolean(id);
  const [step, setStep] = useState(() => searchParams.get("step") === "2" ? 2 : 0);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const saveNoticeTimerRef = useRef<number | null>(null);
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
    requirements: createDefaultEventLevelRequirements(),
    notes: null,
    venue_bookings: [{
      venue: "",
      booking_status: "tentative",
      number_of_shows: 0,
      requirements: createDefaultVenueRequirements(),
      notes: null,
      schedule_days: [],
      schedule_entries: [],
    }],
  });
  // Single-day toggle: when checked, end date is hidden and submitted as null.
  // Defaults ON (most events are single-day). Synced from existing form data on edit.
  const [singleDay, setSingleDay] = useState(true);
  const [requirementsVenueTab, setRequirementsVenueTab] = useState(0);
  const focusedRequirementRef = useRef<string | null>(null);
  const [focusedRequirementField, setFocusedRequirementField] = useState<string | null>(null);

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
    const hydratedForm = hydrateEventFormFromDetail(existing);
    setForm(hydratedForm.form);
    setSingleDay(hydratedForm.singleDay);
    setHydrated(true);
  }, [isEdit, existing, hydrated]);

  useEffect(() => () => {
    if (saveNoticeTimerRef.current != null) window.clearTimeout(saveNoticeTimerRef.current);
  }, []);

  useEffect(() => {
    const section = searchParams.get("section");
    const field = searchParams.get("field");
    const requestedVenue = Math.max(0, Number.parseInt(searchParams.get("venue") ?? "0", 10) || 0);
    const focusKey = `${requestedVenue}:${field ?? section ?? ""}`;
    if (!hydrated || (!section && !field) || focusedRequirementRef.current === focusKey) return;

    const isPocDeepLink = section === "poc" || Boolean(field?.startsWith("poc_"));
    const requiredStep = isPocDeepLink ? 0 : 2;
    if (step !== requiredStep) {
      if (isPocDeepLink) setStep(0);
      return;
    }
    if (!isPocDeepLink && requestedVenue < form.venue_bookings.length && requirementsVenueTab !== requestedVenue) {
      setRequirementsVenueTab(requestedVenue);
      return;
    }
    let focusTimer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(field ? `requirement-field-${field}` : `requirement-${section}`);
      if (!target) return;
      focusedRequirementRef.current = focusKey;
      setFocusedRequirementField(field);
      scrollAppMainToElement(target, "center", "smooth");
      const control = target.matches("input, select, textarea, button")
        ? target
        : target.querySelector<HTMLElement>("input, select, textarea, button");
      focusTimer = window.setTimeout(() => control?.focus({ preventScroll: true }), 250);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (focusTimer != null) window.clearTimeout(focusTimer);
    };
  }, [searchParams, step, hydrated, requirementsVenueTab, form.venue_bookings.length]);

  useEffect(() => {
    if (!form.organisation_id || form.organisation_id.startsWith("new:")) {
      setSelectedOrganisation(null);
    }
  }, [form.organisation_id]);

  const update = (patch: Partial<EventInputT>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation<string | undefined, Error, SaveOptions | void>({
    mutationFn: async () => {
      // If organisation_id is a temporary "new:<name>" token, create the org first.
      let orgId = form.organisation_id;
      if (orgId.startsWith("new:")) {
        const name = orgId.slice(4).trim();
        const created = await apiPost<{ id: string }>("/organisations", { name, org_type: newOrganisationType || null });
        orgId = created.id;
      }
      const venueBookings = prepareVenueBookingsForSave(form.venue_bookings);
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
    onSuccess: async (createdId, variables) => {
      const navigateAfter = variables?.navigateAfter !== false;
      if (!navigateAfter && isEdit && id) {
        const fresh = await queryClient.fetchQuery({
          queryKey: ["event", id, "edit"],
          queryFn: () => apiGet<EventDetailResponse>(`/events/${id}`),
        });
        const hydratedForm = hydrateEventFormFromDetail(fresh);
        setForm(hydratedForm.form);
        setSingleDay(hydratedForm.singleDay);
        setError(null);
        setSaveNotice("Saved");
        if (saveNoticeTimerRef.current != null) window.clearTimeout(saveNoticeTimerRef.current);
        saveNoticeTimerRef.current = window.setTimeout(() => setSaveNotice(null), 3000);
        void queryClient.invalidateQueries({ queryKey: ["event", id] });
        void queryClient.invalidateQueries({ queryKey: ["calendar-lifecycle"], exact: false });
        return;
      }
      navigate(`/events/${createdId ?? id}`);
    },
    onError: (e: Error) => {
      setSaveNotice(null);
      setError(e.message);
    },
  });

  const venues = lookups?.lookups.venue ?? [];
  const sources = lookups?.lookups.enquiry_source ?? [];
  const isVfh = form.event_type === "VFH";

  // Event owners are login accounts (is_event_owner). Programme officers are a
  // separate name+contact list (no login) from lookups.program_officer.
  // Choosing an owner sets both the display label (event_owner) and the identity FK
  // (event_owner_id), so tasks auto-route and "My events" works.
  const { data: usersData } = useQuery<{
    users: Array<{
      id: string;
      name: string;
      is_event_owner?: boolean;
      is_active: number;
    }>;
  }>({
    queryKey: ["users"],
    queryFn: () => apiGet("/users"),
  });
  const activeOwners = (usersData?.users ?? []).filter((u) => u.is_active === 1 && u.is_event_owner);
  const programmeOfficers = (lookups?.lookups.program_officer ?? []).map((o) => ({
    name: o.value,
    contact_number: typeof o.metadata?.contact_number === "string" ? o.metadata.contact_number : null,
  }));
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
    venue_bookings: prepareVenueBookingsForSave(form.venue_bookings),
  });
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
      venue_bookings: [...f.venue_bookings, {
        venue: "",
        booking_status: "tentative",
        number_of_shows: 0,
        requirements: createDefaultVenueRequirements(),
        notes: null,
        schedule_days: [],
        schedule_entries: [],
      }],
    }));
  };
  const removeVenue = (idx: number) => setForm((f) => ({ ...f, venue_bookings: f.venue_bookings.filter((_, i) => i !== idx) }));
  const updateVenue = (idx: number, patch: Partial<VenueBookingInputT>) =>
    setForm((f) => ({ ...f, venue_bookings: f.venue_bookings.map((vb, i) => (i === idx ? { ...vb, ...patch } : vb)) }));

  const addScheduleDay = (vIdx: number) =>
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => {
        if (i !== vIdx) return vb;
        const days = vb.schedule_days?.length ? vb.schedule_days : deriveScheduleDaysFromEntries(vb.schedule_entries);
        const activityDate = nextAvailableScheduleDate(f.event_start_date, new Set(days.map((day) => day.activity_date)));
        const day: ScheduleDayInputT = {
          activity_date: activityDate,
          with_ac_start: null,
          with_ac_end: null,
          with_ac_minutes: null,
          without_ac_start: null,
          without_ac_end: null,
          without_ac_minutes: null,
        };
        return {
          ...vb,
          schedule_days: [...days, day],
          schedule_entries: [...(vb.schedule_entries ?? []), {
            activity_type: "show" as const,
            start_time: null,
            end_time: null,
            ...day,
            notes: null,
          }],
        };
      }),
    }));
  const addScheduleEntry = (vIdx: number, activityDate: string) =>
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => {
        if (i !== vIdx) return vb;
        const day = (vb.schedule_days ?? []).find((candidate) => candidate.activity_date === activityDate);
        return {
          ...vb,
          schedule_entries: [...(vb.schedule_entries ?? []), {
            activity_type: "show" as const,
            activity_date: activityDate,
            start_time: null,
            end_time: null,
            with_ac_start: day?.with_ac_start ?? null,
            with_ac_end: day?.with_ac_end ?? null,
            with_ac_minutes: day?.with_ac_minutes ?? null,
            without_ac_start: day?.without_ac_start ?? null,
            without_ac_end: day?.without_ac_end ?? null,
            without_ac_minutes: day?.without_ac_minutes ?? null,
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
          ? (() => {
            const removedDate = vb.schedule_entries[sIdx]?.activity_date;
            const scheduleEntries = (vb.schedule_entries ?? []).filter((_, j) => j !== sIdx);
            const dateStillUsed = scheduleEntries.some((entry) => entry.activity_date === removedDate);
            return {
              ...vb,
              schedule_days: dateStillUsed ? vb.schedule_days : (vb.schedule_days ?? []).filter((day) => day.activity_date !== removedDate),
              schedule_entries: scheduleEntries,
            };
          })()
          : vb
      )),
    }));
  const removeScheduleDay = (vIdx: number, activityDate: string) =>
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => i === vIdx ? {
        ...vb,
        schedule_days: (vb.schedule_days ?? []).filter((day) => day.activity_date !== activityDate),
        schedule_entries: vb.schedule_entries.filter((entry) => entry.activity_date !== activityDate),
      } : vb),
    }));
  const updateScheduleDay = (vIdx: number, dayIdx: number, patch: Partial<ScheduleDayInputT>) => {
    const booking = form.venue_bookings[vIdx];
    const currentDay = booking?.schedule_days?.[dayIdx];
    if (!booking || !currentDay) return;
    if (patch.activity_date && patch.activity_date !== currentDay.activity_date
      && booking.schedule_days?.some((day, index) => index !== dayIdx && day.activity_date === patch.activity_date)) {
      setError("That date already exists for this venue. Add activities under the existing date instead.");
      return;
    }
    setError(null);
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => {
        if (i !== vIdx) return vb;
        const day = vb.schedule_days?.[dayIdx];
        if (!day) return vb;
        const merged = { ...day, ...patch };
        const nextDay = {
          ...merged,
          with_ac_minutes: diffMinutes(merged.with_ac_start, merged.with_ac_end),
          without_ac_minutes: diffMinutes(merged.without_ac_start, merged.without_ac_end),
        };
        return {
          ...vb,
          schedule_days: (vb.schedule_days ?? []).map((candidate, index) => index === dayIdx ? nextDay : candidate),
          schedule_entries: vb.schedule_entries.map((entry) => entry.activity_date === day.activity_date ? {
            ...entry,
            activity_date: nextDay.activity_date,
            with_ac_start: nextDay.with_ac_start,
            with_ac_end: nextDay.with_ac_end,
            with_ac_minutes: nextDay.with_ac_minutes,
            without_ac_start: nextDay.without_ac_start,
            without_ac_end: nextDay.without_ac_end,
            without_ac_minutes: nextDay.without_ac_minutes,
          } : entry),
        };
      }),
    }));
  };
  const updateScheduleEntry = (vIdx: number, sIdx: number, patch: Partial<ScheduleEntryInputT>) =>
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => {
        if (i !== vIdx) return vb;
        return {
          ...vb,
          schedule_entries: (vb.schedule_entries ?? []).map((se, j) => j === sIdx ? { ...se, ...patch } : se),
        };
      }),
    }));

  // Event-level requirements only (program officer contact). Venue fields live on each booking.
  const reqs = withDefaultEventLevelRequirements(form.requirements as Record<string, unknown> | null);
  const setReq = (key: string, value: unknown) => update({ requirements: { ...reqs, [key]: value } });
  const venueCount = form.venue_bookings.length;
  const timingTotals = useMemo(() => {
    const prepared = prepareVenueBookingsForSave(form.venue_bookings);
    const { acMinutes, withoutAcMinutes } = sumTimingMinutesFromVenueBookings(prepared);
    return {
      acHours: formatHoursTotal(acMinutes),
      nonAcHours: formatHoursTotal(withoutAcMinutes),
      hasData: acMinutes > 0 || withoutAcMinutes > 0,
    };
  }, [form.venue_bookings]);
  const activeRequirementsVenue = Math.min(requirementsVenueTab, Math.max(0, venueCount - 1));
  const updateVenueRequirements = (vIdx: number, next: Record<string, unknown>) => {
    setForm((f) => ({
      ...f,
      venue_bookings: f.venue_bookings.map((vb, i) => (i === vIdx ? { ...vb, requirements: next } : vb)),
    }));
  };

  const canSave = canCreateEvent(form) && !hasDuplicateWarning && !dateError;

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
        saveNotice={saveNotice}
        onSave={(options) => save.mutate(options)}
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
              <Field label="Operating Window — Start Date *">
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
                    <div key={duplicate.id} className="rounded-lg bg-marble-highlight/55 px-3 py-2 text-xs text-ink-primary">
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
              <select
                value={form.program_officer ?? ""}
                onChange={(e) => {
                  const name = e.target.value || null;
                  const officer = programmeOfficers.find((o) => o.name === name);
                  update({ program_officer: name });
                  if (officer?.contact_number) {
                    setReq("program_officer_phone", officer.contact_number);
                  }
                }}
                className="carved input"
              >
                <option value="">Select…</option>
                {programmeOfficers.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
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

      {/* Step 2: Venues & Schedule — one venue-day operating window with activities beneath it. */}
      {step === 1 && (
        <div className="space-y-4">
          {timingTotals.hasData && (
            <div className="carved-card rounded-2xl bg-sage/10 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sage etched">Event timing totals</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Total AC hours</span>
                  <p className="mt-1 text-lg font-semibold text-ink-primary etched-deep">{timingTotals.acHours}</p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Total non-AC hours</span>
                  <p className="mt-1 text-lg font-semibold text-ink-primary etched-deep">{timingTotals.nonAcHours}</p>
                </div>
              </div>
            </div>
          )}
          {form.venue_bookings.map((vb, vIdx) => {
            const scheduleDays = vb.schedule_days?.length ? vb.schedule_days : deriveScheduleDaysFromEntries(vb.schedule_entries);
            const showsByDate = countScheduledShowsByDate(vb.schedule_entries);
            const totalShows = deriveVenueShowCount(vb.schedule_entries, vb.number_of_shows);
            const usesLegacyShowTotal = vb.schedule_entries.length === 0 && vb.number_of_shows > 0;
            return (
            <div key={vb.id ?? `venue-${vIdx}`} className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-primary etched-deep">Venue Booking {vIdx + 1}</h3>
                {form.venue_bookings.length > 1 && (
                  <button type="button" onClick={() => removeVenue(vIdx)} className="text-xs text-status-cancelled hover:underline">Remove</button>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Venue">
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
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-sage etched">Total Shows</span>
                  <div
                    role="status"
                    aria-live="polite"
                    aria-label={`${totalShows} total shows. ${usesLegacyShowTotal ? "Legacy total preserved until schedule details are added." : "Auto-calculated from Schedule Details."}`}
                    className="carved flex min-h-[42px] items-center justify-between gap-3 rounded-xl border border-ink-muted/15 bg-marble-highlight/45 px-4 py-2"
                  >
                    <output className="text-lg font-semibold text-ink-primary etched-deep">{totalShows}</output>
                    <span className="text-right text-[10px] font-medium leading-tight text-ink-muted etched">
                      {usesLegacyShowTotal
                        ? "Legacy total — add schedule details to auto-calculate"
                        : "Auto-calculated from Schedule Details"}
                    </span>
                  </div>
                </div>
              </div>

              {/* One operating window per date; individual activities sit underneath it. */}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-sage etched">Schedule Details</span>
                  <button type="button" onClick={() => addScheduleDay(vIdx)} className="text-xs text-sage-text hover:underline">
                    {scheduleDays.length > 0 ? "+ Add another date" : "+ Add date"}
                  </button>
                </div>
                <p className="mb-3 text-xs text-ink-muted etched">
                  Set the venue's AC and non-AC operating window once for each date, then add every show or activity taking place within it.
                </p>
                <div className="space-y-4">
                  {scheduleDays.map((day, dayIdx) => {
                    const entries = vb.schedule_entries
                      .map((entry, index) => ({ entry, index }))
                      .filter(({ entry }) => entry.activity_date === day.activity_date);
                    const dailyShowCount = showsByDate.get(day.activity_date) ?? 0;
                    const withMin = day.with_ac_minutes ?? diffMinutes(day.with_ac_start, day.with_ac_end);
                    const withoutMin = day.without_ac_minutes ?? diffMinutes(day.without_ac_start, day.without_ac_end);
                    const total = (withMin ?? 0) + (withoutMin ?? 0);
                    return (
                    <section key={day.activity_date} className="rounded-xl border border-marble-shadow/30 bg-marble-shadow/15 p-3 sm:p-4">
                      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-marble-shadow/30 pb-3">
                        <div className="w-full sm:w-auto sm:min-w-48">
                          <Field label="Date">
                            <input
                              type="date"
                              lang="en-GB"
                              value={day.activity_date}
                              onChange={(e) => updateScheduleDay(vIdx, dayIdx, { activity_date: e.target.value })}
                              className="carved input"
                            />
                          </Field>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {dailyShowCount > 0 && (
                            <span className="rounded-full bg-sage/10 px-3 py-1 text-[11px] font-semibold text-sage-text etched">
                              {dailyShowCount} {dailyShowCount === 1 ? "show" : "shows"}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => addScheduleEntry(vIdx, day.activity_date)}
                            className="text-[11px] font-semibold text-sage-text hover:underline"
                          >
                            + Add activity on this date
                          </button>
                          <button type="button" onClick={() => removeScheduleDay(vIdx, day.activity_date)} className="text-[11px] text-status-cancelled hover:underline">Remove date</button>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg bg-marble-highlight/50 p-2">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sage etched">With AC</div>
                          <div className="grid grid-cols-3 items-end gap-2">
                            <Field label="Start"><input type="time" lang="en-GB" value={day.with_ac_start ?? ""} onChange={(e) => updateScheduleDay(vIdx, dayIdx, { with_ac_start: e.target.value || null })} className="carved input" /></Field>
                            <Field label="End"><input type="time" lang="en-GB" value={day.with_ac_end ?? ""} onChange={(e) => updateScheduleDay(vIdx, dayIdx, { with_ac_end: e.target.value || null })} className="carved input" /></Field>
                            <Field label="Duration"><input readOnly value={formatDuration(withMin)} className="carved input bg-transparent" /></Field>
                          </div>
                        </div>
                        <div className="rounded-lg bg-marble-highlight/50 p-2">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sage etched">Without AC</div>
                          <div className="grid grid-cols-3 items-end gap-2">
                            <Field label="Start"><input type="time" lang="en-GB" value={day.without_ac_start ?? ""} onChange={(e) => updateScheduleDay(vIdx, dayIdx, { without_ac_start: e.target.value || null })} className="carved input" /></Field>
                            <Field label="End"><input type="time" lang="en-GB" value={day.without_ac_end ?? ""} onChange={(e) => updateScheduleDay(vIdx, dayIdx, { without_ac_end: e.target.value || null })} className="carved input" /></Field>
                            <Field label="Duration"><input readOnly value={formatDuration(withoutMin)} className="carved input bg-transparent" /></Field>
                          </div>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-ink-muted etched">
                        Hall rental for this date = Without AC + With AC = <strong className="text-sage-text">{formatDuration(total)}</strong>
                      </p>

                      <div className="mt-4 space-y-2">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Activities</h4>
                        {entries.map(({ entry: se, index: sIdx }, groupIndex) => {
                    const showNumber = se.activity_type === "show"
                      ? entries.slice(0, groupIndex + 1).filter(({ entry }) => entry.activity_type === "show").length
                      : null;
                    return (
                      <div key={se.id ?? `${day.activity_date}-${sIdx}`} className="rounded-xl bg-marble-shadow/30 p-3">
                        {showNumber != null && (
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-terracotta-text etched">
                            Show {showNumber} of {dailyShowCount || 1}
                          </div>
                        )}
                        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
                          <Field label="Activity">
                            <select value={se.activity_type} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { activity_type: e.target.value as ScheduleEntryInputT["activity_type"] })} className="carved input">
                              {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{formatActivityType(a)}</option>)}
                            </select>
                          </Field>
                          <Field label="Activity Start">
                            <input type="time" lang="en-GB" value={se.start_time ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { start_time: e.target.value || null })} className="carved input" />
                          </Field>
                          <Field label="Activity End">
                            <input type="time" lang="en-GB" value={se.end_time ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { end_time: e.target.value || null })} className="carved input" />
                          </Field>
                        </div>
                        <div className="mt-2 flex justify-end text-[11px] etched">
                          <button type="button" onClick={() => removeScheduleEntry(vIdx, sIdx)} className="text-status-cancelled hover:underline">Remove</button>
                        </div>
                      </div>
                    );
                      })}
                      </div>
                    </section>
                    );
                  })}
                  {scheduleDays.length === 0 && <p className="text-xs text-ink-muted etched">No dates yet. Add a date, set its venue operating window, then add setup, rehearsal, show, dismantling, or zero show activities.</p>}
                </div>
              </div>
            </div>
            );
          })}
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
                focusedFieldKey={focusedRequirementField}
                scheduleEntries={form.venue_bookings[activeRequirementsVenue]?.schedule_entries ?? []}
                legacyShowCount={form.venue_bookings[activeRequirementsVenue]?.number_of_shows ?? null}
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
        saveNotice={saveNotice}
        onSave={(options) => save.mutate(options)}
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
  saveNotice,
  onSave,
  className = "mb-5",
}: {
  step: number;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  canSave: boolean;
  isEdit: boolean;
  isSaving: boolean;
  saveNotice?: string | null;
  onSave: (options?: SaveOptions) => void;
  className?: string;
}) {
  const onReviewStep = step === STEPS.length - 1;
  const showMidStepSave = isEdit && !onReviewStep;

  return (
    <div className={"flex items-center justify-between gap-3 " + className}>
      <button
        type="button"
        onClick={() => setStep((s) => Math.max(0, s - 1))}
        disabled={step === 0}
        className="carved-btn rounded-full bg-neutral-btn px-5 py-2 text-sm font-medium text-ink-secondary etched disabled:opacity-40"
      >
        Back
      </button>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {saveNotice ? (
          <span role="status" className="text-xs font-medium text-sage-text etched">
            {saveNotice}
          </span>
        ) : null}
        {showMidStepSave ? (
          <button
            type="button"
            onClick={() => onSave({ navigateAfter: false })}
            disabled={isSaving || !canSave}
            className="carved-btn rounded-full bg-neutral-btn px-5 py-2 text-sm font-medium text-ink-secondary etched hover:bg-marble-shadow/60 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        ) : null}
        {!onReviewStep ? (
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
            onClick={() => onSave()}
            disabled={isSaving || !canSave}
            className="carved-btn-terracotta rounded-full bg-terracotta-btn px-5 py-2 text-sm font-semibold text-terracotta-text etched hover:bg-terracotta-btn-hover disabled:opacity-60"
          >
            {isSaving ? "Saving..." : isEdit ? "Save changes" : "Create event"}
          </button>
        )}
      </div>
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
    <div className="flex min-h-24 h-full flex-col items-center justify-center rounded-xl border border-ink-muted/10 bg-marble-highlight/35 px-4 py-3 text-center">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="mt-2 w-full max-w-full whitespace-normal break-words text-center font-medium leading-relaxed text-ink-primary etched-deep">{String(value ?? "—")}</dd>
    </div>
  );
}
