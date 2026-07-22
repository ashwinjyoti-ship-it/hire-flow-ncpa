import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GoToTopButton } from "../components/GoToTopButton";
import { PageHeader } from "../components/PageHeader";
import { RequirementsFields } from "../components/event-form/RequirementsFields";
import { VenueScheduleFields } from "../components/event-form/VenueScheduleFields";
import { apiGet, apiPut } from "../lib/api";
import {
  buildEventRequirementsPayload,
  hydrateVenueRequirements,
  parseRequirements,
  pickEventLevelRequirements,
  prepareVenueBookingsForSave,
  withDefaultVenueRequirements,
} from "../lib/event-edit-form";
import { formatDate, useLookups } from "../lib/use-lookups";
import type { ScheduleDayInputT, ScheduleEntryInputT, VenueBookingInputT } from "../../worker/lib/types";

type MeetingDetailResponse = {
  event: {
    id: string;
    title: string;
    organisation_name: string | null;
    event_start_date: string | null;
    event_end_date: string | null;
    requirements: Record<string, unknown> | string | null;
  };
  venue_bookings: Array<{
    id: string;
    venue: string;
    booking_status: VenueBookingInputT["booking_status"];
    number_of_shows: number;
    requirements: Record<string, unknown> | string | null;
    notes: string | null;
    schedule_days?: ScheduleDayInputT[];
    schedule_entries: ScheduleEntryInputT[];
  }>;
};

const TOP_ID = "meeting-form-top";

function hydrateBookings(detail: MeetingDetailResponse): VenueBookingInputT[] {
  const bookings = detail.venue_bookings.map((booking) => ({
    ...booking,
    requirements: withDefaultVenueRequirements(parseRequirements(booking.requirements)),
  }));
  return hydrateVenueRequirements(bookings, parseRequirements(detail.event.requirements));
}

export function MeetingFormPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { data: lookups } = useLookups();
  const [bookings, setBookings] = useState<VenueBookingInputT[]>([]);
  const [activeVenue, setActiveVenue] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["event", id, "meeting-form"],
    queryFn: () => apiGet<MeetingDetailResponse>(`/events/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!data || hydrated) return;
    setBookings(hydrateBookings(data));
    setHydrated(true);
  }, [data, hydrated]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () => {
      if (!id || !data) throw new Error("Event not found");
      const venueBookings = prepareVenueBookingsForSave(bookings);
      const eventLevelRequirements = pickEventLevelRequirements(parseRequirements(data.event.requirements));
      const requirements = buildEventRequirementsPayload(venueBookings, eventLevelRequirements);
      await apiPut(`/events/${id}`, {
        requirements: Object.keys(requirements).length > 0 ? requirements : null,
        venue_bookings: venueBookings,
      });
    },
    onSuccess: () => {
      setDirty(false);
      setSaveNotice("Saved to the event form");
      void queryClient.invalidateQueries({ queryKey: ["event", id] });
      window.setTimeout(() => setSaveNotice(null), 3000);
    },
    onError: () => setSaveNotice(null),
  });

  const activeBookingIndex = Math.min(activeVenue, Math.max(0, bookings.length - 1));
  const activeBooking = bookings[activeBookingIndex];
  const dateSummary = useMemo(() => {
    if (!data?.event.event_start_date) return "Date not set";
    const start = formatDate(data.event.event_start_date);
    const end = data.event.event_end_date && data.event.event_end_date !== data.event.event_start_date
      ? ` to ${formatDate(data.event.event_end_date)}`
      : "";
    return `${start}${end}`;
  }, [data]);

  function updateActiveRequirements(next: Record<string, unknown>) {
    setBookings((current) => current.map((booking, index) => (
      index === activeBookingIndex ? { ...booking, requirements: next } : booking
    )));
    setDirty(true);
    setSaveNotice(null);
  }

  function updateVenueBookings(updater: (current: VenueBookingInputT[]) => VenueBookingInputT[]) {
    setBookings((current) => updater(current));
    setDirty(true);
    setSaveNotice(null);
  }

  if (loadError || !data) {
    if (isLoading) return <div className="text-sm text-ink-muted">Loading meeting form…</div>;
    return <div role="alert" className="rounded-xl bg-status-cancelled/10 px-4 py-3 text-sm text-status-cancelled">{(loadError as Error)?.message ?? "Event not found"}</div>;
  }
  if (!hydrated) return <div className="text-sm text-ink-muted">Loading meeting form…</div>;

  return (
    <div id={TOP_ID}>
      <PageHeader
        title="Meeting Form"
        subtitle={`${data.event.organisation_name ?? "—"} · ${data.event.title}`}
        actions={
          <Link to={`/events/${id}`} className="carved-btn rounded-full bg-neutral-btn px-4 py-2 text-sm font-medium text-ink-secondary etched">
            Back to event
          </Link>
        }
      />

      <div className="carved-card mb-5 grid gap-3 rounded-2xl bg-marble-highlight/50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Summary label="Client" value={data.event.organisation_name ?? "—"} />
        <Summary label="Event" value={data.event.title} />
        <Summary label="Event dates" value={dateSummary} />
      </div>

      <div className="sticky top-0 z-30 mb-5 rounded-2xl border border-marble-shadow/35 bg-marble-base/95 p-3 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-ink-muted etched">Existing event details are shown below. Change only what was updated in the meeting.</span>
          <div className="flex items-center gap-3">
            <span aria-live="polite" className="text-xs font-medium text-sage-text etched">
              {saveNotice ?? (dirty ? "Unsaved changes" : "")}
            </span>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
              className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save Meeting Form"}
            </button>
          </div>
        </div>
      </div>

      {(save.error || scheduleError) && (
        <div role="alert" className="mb-4 rounded-xl bg-status-cancelled/10 px-4 py-3 text-sm text-status-cancelled">
          {(save.error as Error | null)?.message ?? scheduleError}
        </div>
      )}

      <VenueScheduleFields
        eventStartDate={data.event.event_start_date}
        venueBookings={bookings}
        venueOptions={lookups?.lookups.venue ?? []}
        updateVenueBookings={updateVenueBookings}
        onError={setScheduleError}
        layout="tabs"
      />

      <section aria-labelledby="meeting-requirements-heading" className="mt-8">
        <h2 id="meeting-requirements-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Requirements</h2>
        {bookings.length > 0 ? (
          <>
            <div className="mb-4 rounded-2xl border border-marble-shadow/35 bg-marble-base/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2" aria-label="Select requirements venue">
                <span className="mr-1 text-xs font-medium text-ink-muted etched">Requirements for:</span>
                {bookings.map((booking, index) => (
                  <button
                    key={booking.id ?? `${booking.venue}-${index}`}
                    type="button"
                    onClick={() => setActiveVenue(index)}
                    aria-current={index === activeBookingIndex ? "true" : undefined}
                    className={
                      "rounded-full px-4 py-2 text-xs font-semibold etched "
                      + (index === activeBookingIndex
                        ? "carved-btn-terracotta bg-terracotta-btn text-terracotta-text"
                        : "carved-btn bg-neutral-btn text-ink-secondary")
                    }
                  >
                    {booking.venue || `Venue ${index + 1}`}
                  </button>
                ))}
              </div>
            </div>
          </div>

            {activeBooking && (
            <RequirementsFields
              value={(activeBooking.requirements ?? {}) as Record<string, unknown>}
              onChange={updateActiveRequirements}
              scheduleEntries={activeBooking.schedule_entries}
              legacyShowCount={activeBooking.number_of_shows}
            />
          )}
          </>
        ) : (
          <p className="text-sm text-ink-muted etched">Add a venue above before entering venue requirements.</p>
        )}
      </section>

      <div className="mt-6 flex items-center justify-end gap-3">
        <span aria-live="polite" className="text-xs font-medium text-sage-text etched">
          {saveNotice ?? (dirty ? "Unsaved changes" : "")}
        </span>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save Meeting Form"}
        </button>
      </div>
      <GoToTopButton targetId={TOP_ID} />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-sage etched">{label}</dt>
      <dd className="mt-1 font-medium text-ink-primary etched-deep">{value}</dd>
    </div>
  );
}
