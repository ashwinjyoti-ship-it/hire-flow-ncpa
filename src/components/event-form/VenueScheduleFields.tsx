import { useMemo, useState } from "react";
import { formatHoursTotal, sumTimingMinutesFromVenueBookings } from "../../../worker/lib/timing-sync";
import { countScheduledShowsByDate, deriveVenueShowCount } from "../../../worker/lib/show-schedule";
import { deriveScheduleDaysFromEntries } from "../../../worker/lib/schedule-days";
import {
  ACTIVITY_TYPES,
  formatActivityType,
  type ScheduleDayInputT,
  type ScheduleEntryInputT,
  type VenueBookingInputT,
} from "../../../worker/lib/types";
import { createDefaultVenueRequirements, prepareVenueBookingsForSave } from "../../lib/event-edit-form";
import { formatDuration } from "../../lib/use-lookups";

type VenueOption = { value: string };

type VenueScheduleFieldsProps = {
  eventStartDate: string | null | undefined;
  venueBookings: VenueBookingInputT[];
  venueOptions: VenueOption[];
  updateVenueBookings: (updater: (current: VenueBookingInputT[]) => VenueBookingInputT[]) => void;
  onError?: (message: string | null) => void;
  layout?: "stacked" | "tabs";
};

function diffMinutes(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (sh == null || sm == null || eh == null || em == null) return null;
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

function nextAvailableScheduleDate(startDate: string | null | undefined, usedDates: Set<string>): string {
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(startDate ?? "") ? startDate! : new Date().toISOString().slice(0, 10);
  const date = new Date(`${candidate}T00:00:00.000Z`);
  while (usedDates.has(date.toISOString().slice(0, 10))) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function VenueScheduleFields({
  eventStartDate,
  venueBookings,
  venueOptions,
  updateVenueBookings,
  onError,
  layout = "stacked",
}: VenueScheduleFieldsProps) {
  const [activeVenueIndex, setActiveVenueIndex] = useState(0);
  const safeActiveVenueIndex = Math.min(activeVenueIndex, Math.max(0, venueBookings.length - 1));

  const timingTotals = useMemo(() => {
    const prepared = prepareVenueBookingsForSave(venueBookings);
    const { acMinutes, withoutAcMinutes } = sumTimingMinutesFromVenueBookings(prepared);
    return {
      acHours: formatHoursTotal(acMinutes),
      nonAcHours: formatHoursTotal(withoutAcMinutes),
      hasData: acMinutes > 0 || withoutAcMinutes > 0,
    };
  }, [venueBookings]);

  const visibleVenueBookings = venueBookings
    .map((booking, venueIndex) => ({ booking, venueIndex }))
    .filter(({ venueIndex }) => layout !== "tabs" || venueIndex === safeActiveVenueIndex);

  function addVenue() {
    if (layout === "tabs") setActiveVenueIndex(venueBookings.length);
    updateVenueBookings((current) => [...current, {
      venue: "",
      booking_status: "tentative",
      number_of_shows: 0,
      requirements: createDefaultVenueRequirements(),
      notes: null,
      schedule_days: [],
      schedule_entries: [],
    }]);
  }

  function removeVenue(index: number) {
    if (layout === "tabs") setActiveVenueIndex(Math.min(index, Math.max(0, venueBookings.length - 2)));
    updateVenueBookings((current) => current.filter((_, candidate) => candidate !== index));
  }

  function updateVenue(index: number, patch: Partial<VenueBookingInputT>) {
    updateVenueBookings((current) => current.map((booking, candidate) => candidate === index ? { ...booking, ...patch } : booking));
  }

  function addScheduleDay(venueIndex: number) {
    updateVenueBookings((current) => current.map((booking, index) => {
      if (index !== venueIndex) return booking;
      const days = booking.schedule_days?.length ? booking.schedule_days : deriveScheduleDaysFromEntries(booking.schedule_entries);
      const activityDate = nextAvailableScheduleDate(eventStartDate, new Set(days.map((day) => day.activity_date)));
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
        ...booking,
        schedule_days: [...days, day],
        schedule_entries: [...booking.schedule_entries, {
          activity_type: "show",
          start_time: null,
          end_time: null,
          ...day,
          notes: null,
        }],
      };
    }));
  }

  function addScheduleEntry(venueIndex: number, activityDate: string) {
    updateVenueBookings((current) => current.map((booking, index) => {
      if (index !== venueIndex) return booking;
      const day = (booking.schedule_days ?? []).find((candidate) => candidate.activity_date === activityDate);
      return {
        ...booking,
        schedule_entries: [...booking.schedule_entries, {
          activity_type: "show",
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
    }));
  }

  function removeScheduleEntry(venueIndex: number, scheduleIndex: number) {
    updateVenueBookings((current) => current.map((booking, index) => {
      if (index !== venueIndex) return booking;
      const removedDate = booking.schedule_entries[scheduleIndex]?.activity_date;
      const scheduleEntries = booking.schedule_entries.filter((_, candidate) => candidate !== scheduleIndex);
      const dateStillUsed = scheduleEntries.some((entry) => entry.activity_date === removedDate);
      return {
        ...booking,
        schedule_days: dateStillUsed
          ? booking.schedule_days
          : (booking.schedule_days ?? []).filter((day) => day.activity_date !== removedDate),
        schedule_entries: scheduleEntries,
      };
    }));
  }

  function removeScheduleDay(venueIndex: number, activityDate: string) {
    updateVenueBookings((current) => current.map((booking, index) => index === venueIndex ? {
      ...booking,
      schedule_days: (booking.schedule_days ?? []).filter((day) => day.activity_date !== activityDate),
      schedule_entries: booking.schedule_entries.filter((entry) => entry.activity_date !== activityDate),
    } : booking));
  }

  function updateScheduleDay(venueIndex: number, dayIndex: number, patch: Partial<ScheduleDayInputT>) {
    const booking = venueBookings[venueIndex];
    const currentDay = booking?.schedule_days?.[dayIndex];
    if (!booking || !currentDay) return;
    if (patch.activity_date && patch.activity_date !== currentDay.activity_date
      && booking.schedule_days?.some((day, index) => index !== dayIndex && day.activity_date === patch.activity_date)) {
      onError?.("That date already exists for this venue. Add activities under the existing date instead.");
      return;
    }
    onError?.(null);
    updateVenueBookings((current) => current.map((candidate, index) => {
      if (index !== venueIndex) return candidate;
      const day = candidate.schedule_days?.[dayIndex];
      if (!day) return candidate;
      const merged = { ...day, ...patch };
      const nextDay = {
        ...merged,
        with_ac_minutes: diffMinutes(merged.with_ac_start, merged.with_ac_end),
        without_ac_minutes: diffMinutes(merged.without_ac_start, merged.without_ac_end),
      };
      return {
        ...candidate,
        schedule_days: (candidate.schedule_days ?? []).map((item, itemIndex) => itemIndex === dayIndex ? nextDay : item),
        schedule_entries: candidate.schedule_entries.map((entry) => entry.activity_date === day.activity_date ? {
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
    }));
  }

  function updateScheduleEntry(venueIndex: number, scheduleIndex: number, patch: Partial<ScheduleEntryInputT>) {
    updateVenueBookings((current) => current.map((booking, index) => index === venueIndex ? {
      ...booking,
      schedule_entries: booking.schedule_entries.map((entry, candidate) => candidate === scheduleIndex ? { ...entry, ...patch } : entry),
    } : booking));
  }

  return (
    <section aria-labelledby="venue-schedule-heading" className="space-y-4">
      <div>
        <h2 id="venue-schedule-heading" className="text-sm font-semibold uppercase tracking-wider text-sage etched">Venues &amp; Schedule</h2>
        <p className="mt-1 text-xs text-ink-muted etched">Confirm venue dates, activities, and AC/non-AC operating windows discussed in the meeting.</p>
      </div>

      {timingTotals.hasData && (
        <div className="carved-card rounded-2xl bg-sage/10 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sage etched">Event timing totals</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <TimingTotal label="Total AC hours" value={timingTotals.acHours} />
            <TimingTotal label="Total non-AC hours" value={timingTotals.nonAcHours} />
          </div>
        </div>
      )}

      {layout === "tabs" && (
        <div className="flex items-center gap-2 overflow-x-auto rounded-2xl border border-marble-shadow/35 bg-marble-base/70 p-2" role="tablist" aria-label="Venue schedules">
          {venueBookings.map((booking, venueIndex) => (
            <button
              key={booking.id ?? `venue-tab-${venueIndex}`}
              id={`venue-schedule-tab-${venueIndex}`}
              type="button"
              role="tab"
              aria-selected={venueIndex === safeActiveVenueIndex}
              aria-controls={`venue-schedule-panel-${venueIndex}`}
              onClick={() => setActiveVenueIndex(venueIndex)}
              className={
                "shrink-0 rounded-full px-4 py-2 text-xs font-semibold etched "
                + (venueIndex === safeActiveVenueIndex
                  ? "carved-btn-terracotta bg-terracotta-btn text-terracotta-text"
                  : "carved-btn bg-neutral-btn text-ink-secondary")
              }
            >
              {booking.venue || `Venue ${venueIndex + 1}`}
            </button>
          ))}
          <button type="button" onClick={addVenue} className="carved-btn-sage shrink-0 rounded-full bg-sage-btn px-4 py-2 text-xs font-semibold text-sage-text etched">
            + Add venue
          </button>
        </div>
      )}

      {visibleVenueBookings.map(({ booking, venueIndex }) => {
        const scheduleDays = booking.schedule_days?.length ? booking.schedule_days : deriveScheduleDaysFromEntries(booking.schedule_entries);
        const showsByDate = countScheduledShowsByDate(booking.schedule_entries);
        const totalShows = deriveVenueShowCount(booking.schedule_entries, booking.number_of_shows);
        const usesLegacyShowTotal = booking.schedule_entries.length === 0 && booking.number_of_shows > 0;
        return (
          <div
            data-testid={`venue-booking-${venueIndex}`}
            id={layout === "tabs" ? `venue-schedule-panel-${venueIndex}` : undefined}
            role={layout === "tabs" ? "tabpanel" : undefined}
            aria-labelledby={layout === "tabs" ? `venue-schedule-tab-${venueIndex}` : undefined}
            key={booking.id ?? `venue-${venueIndex}`}
            className="carved-card rounded-2xl bg-marble-highlight/50 p-5"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-primary etched-deep">Venue Booking {venueIndex + 1}</h3>
              {venueBookings.length > 1 && (
                <button type="button" onClick={() => removeVenue(venueIndex)} className="text-xs text-status-cancelled hover:underline">Remove</button>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Venue">
                <select value={booking.venue} onChange={(event) => updateVenue(venueIndex, { venue: event.target.value })} className="carved input">
                  <option value="">Select…</option>
                  {venueOptions.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}
                </select>
              </Field>
              <Field label="Booking Status">
                <select value={booking.booking_status} onChange={(event) => updateVenue(venueIndex, { booking_status: event.target.value as VenueBookingInputT["booking_status"] })} className="carved input">
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
                    {usesLegacyShowTotal ? "Legacy total — add schedule details to auto-calculate" : "Auto-calculated from Schedule Details"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-sage etched">Schedule Details</span>
                <button type="button" onClick={() => addScheduleDay(venueIndex)} className="text-xs text-sage-text hover:underline">
                  {scheduleDays.length > 0 ? "+ Add another date" : "+ Add date"}
                </button>
              </div>
              <p className="mb-3 text-xs text-ink-muted etched">Set the venue's AC and non-AC operating window once for each date, then add every show or activity taking place within it.</p>
              <div className="space-y-4">
                {scheduleDays.map((day, dayIndex) => {
                  const entries = booking.schedule_entries
                    .map((entry, index) => ({ entry, index }))
                    .filter(({ entry }) => entry.activity_date === day.activity_date);
                  const dailyShowCount = showsByDate.get(day.activity_date) ?? 0;
                  const withMinutes = day.with_ac_minutes ?? diffMinutes(day.with_ac_start, day.with_ac_end);
                  const withoutMinutes = day.without_ac_minutes ?? diffMinutes(day.without_ac_start, day.without_ac_end);
                  const totalMinutes = (withMinutes ?? 0) + (withoutMinutes ?? 0);
                  return (
                    <section data-testid={`schedule-day-${venueIndex}-${dayIndex}`} key={day.activity_date} className="rounded-xl border border-marble-shadow/30 bg-marble-shadow/15 p-3 sm:p-4">
                      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-marble-shadow/30 pb-3">
                        <div className="w-full sm:w-auto sm:min-w-48">
                          <Field label="Date">
                            <input type="date" lang="en-GB" value={day.activity_date} onChange={(event) => updateScheduleDay(venueIndex, dayIndex, { activity_date: event.target.value })} className="carved input" />
                          </Field>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {dailyShowCount > 0 && (
                            <span className="rounded-full bg-sage/10 px-3 py-1 text-[11px] font-semibold text-sage-text etched">{dailyShowCount} {dailyShowCount === 1 ? "show" : "shows"}</span>
                          )}
                          <button type="button" onClick={() => addScheduleEntry(venueIndex, day.activity_date)} className="text-[11px] font-semibold text-sage-text hover:underline">+ Add activity on this date</button>
                          <button type="button" onClick={() => removeScheduleDay(venueIndex, day.activity_date)} className="text-[11px] text-status-cancelled hover:underline">Remove date</button>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <OperatingWindow
                          label="With AC"
                          start={day.with_ac_start}
                          end={day.with_ac_end}
                          minutes={withMinutes}
                          onStartChange={(value) => updateScheduleDay(venueIndex, dayIndex, { with_ac_start: value })}
                          onEndChange={(value) => updateScheduleDay(venueIndex, dayIndex, { with_ac_end: value })}
                        />
                        <OperatingWindow
                          label="Without AC"
                          start={day.without_ac_start}
                          end={day.without_ac_end}
                          minutes={withoutMinutes}
                          onStartChange={(value) => updateScheduleDay(venueIndex, dayIndex, { without_ac_start: value })}
                          onEndChange={(value) => updateScheduleDay(venueIndex, dayIndex, { without_ac_end: value })}
                        />
                      </div>
                      <p className="mt-2 text-[11px] text-ink-muted etched">Hall rental for this date = Without AC + With AC = <strong className="text-sage-text">{formatDuration(totalMinutes)}</strong></p>

                      <div className="mt-4 space-y-2">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">Activities</h4>
                        {entries.map(({ entry, index: scheduleIndex }, groupIndex) => {
                          const showNumber = entry.activity_type === "show"
                            ? entries.slice(0, groupIndex + 1).filter((candidate) => candidate.entry.activity_type === "show").length
                            : null;
                          return (
                            <div key={entry.id ?? `${day.activity_date}-${scheduleIndex}`} className="rounded-xl bg-marble-shadow/30 p-3">
                              {showNumber != null && (
                                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-terracotta-text etched">Show {showNumber} of {dailyShowCount || 1}</div>
                              )}
                              <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
                                <Field label="Activity">
                                  <select value={entry.activity_type} onChange={(event) => updateScheduleEntry(venueIndex, scheduleIndex, { activity_type: event.target.value as ScheduleEntryInputT["activity_type"] })} className="carved input">
                                    {ACTIVITY_TYPES.map((activity) => <option key={activity} value={activity}>{formatActivityType(activity)}</option>)}
                                  </select>
                                </Field>
                                <Field label="Activity Start">
                                  <input type="time" lang="en-GB" value={entry.start_time ?? ""} onChange={(event) => updateScheduleEntry(venueIndex, scheduleIndex, { start_time: event.target.value || null })} className="carved input" />
                                </Field>
                                <Field label="Activity End">
                                  <input type="time" lang="en-GB" value={entry.end_time ?? ""} onChange={(event) => updateScheduleEntry(venueIndex, scheduleIndex, { end_time: event.target.value || null })} className="carved input" />
                                </Field>
                              </div>
                              <div className="mt-2 flex justify-end text-[11px] etched">
                                <button type="button" onClick={() => removeScheduleEntry(venueIndex, scheduleIndex)} className="text-status-cancelled hover:underline">Remove</button>
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

      {layout === "stacked" && (
        <button type="button" onClick={addVenue} className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched">+ Add venue</button>
      )}
    </section>
  );
}

function OperatingWindow({
  label,
  start,
  end,
  minutes,
  onStartChange,
  onEndChange,
}: {
  label: string;
  start: string | null | undefined;
  end: string | null | undefined;
  minutes: number | null;
  onStartChange: (value: string | null) => void;
  onEndChange: (value: string | null) => void;
}) {
  return (
    <div className="rounded-lg bg-marble-highlight/50 p-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sage etched">{label}</div>
      <div className="grid grid-cols-3 items-end gap-2">
        <Field label="Start"><input aria-label={`${label} Start`} type="time" lang="en-GB" value={start ?? ""} onChange={(event) => onStartChange(event.target.value || null)} className="carved input" /></Field>
        <Field label="End"><input aria-label={`${label} End`} type="time" lang="en-GB" value={end ?? ""} onChange={(event) => onEndChange(event.target.value || null)} className="carved input" /></Field>
        <Field label="Duration"><input aria-label={`${label} Duration`} readOnly value={formatDuration(minutes)} className="carved input bg-transparent" /></Field>
      </div>
    </div>
  );
}

function TimingTotal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted etched">{label}</span>
      <p className="mt-1 text-lg font-semibold text-ink-primary etched-deep">{value}</p>
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
