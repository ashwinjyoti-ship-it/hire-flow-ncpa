import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { apiPost, apiPut } from "../lib/api";
import { useLookups } from "../lib/use-lookups";
import type { EventInputT, VenueBookingInputT, ScheduleEntryInputT } from "../../worker/lib/types";
import { ACTIVITY_TYPES } from "../../worker/lib/types";

const STEPS = ["Event & Client", "Venues & Schedule", "Requirements", "Documents", "Review"] as const;

export function EventEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: lookups } = useLookups();
  const isEdit = Boolean(id);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState<EventInputT>({
    title: "",
    description: null,
    organisation_id: null,
    primary_contact_id: null,
    event_type: null,
    hiring_category: null,
    vertical: null,
    program_officer: null,
    event_owner: null,
    collaboration_details: null,
    event_start_date: null,
    event_end_date: null,
    enquiry_source: null,
    priority: "medium",
    requirements: null,
    notes: null,
    venue_bookings: [{ venue: "", booking_status: "tentative", number_of_shows: 1, ac_start: null, ac_end: null, event_duration_minutes: null, requirements: null, notes: null, schedule_entries: [] }],
  });

  const update = (patch: Partial<EventInputT>) => setForm((f) => ({ ...f, ...patch }));

  // Track the newly-created event id for post-save navigation.
  let lastCreatedId: string | undefined;

  const save = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (isEdit && id) {
        // Omit venue_bookings on edit (managed via separate sub-routes later).
        const { venue_bookings: _vb, ...rest } = form;
        void _vb;
        await apiPut(`/events/${id}`, rest);
        return;
      }
      const res = await apiPost<{ id: string }>("/events", form);
      lastCreatedId = res.id;
    },
    onSuccess: () => navigate(`/events/${lastCreatedId ?? id}`),
    onError: (e: Error) => setError(e.message),
  });

  const venues = lookups?.lookups.venue ?? [];
  const programOfficers = lookups?.lookups.program_officer ?? [];
  const owners = lookups?.lookups.handled_by ?? [];
  const sources = lookups?.lookups.enquiry_source ?? [];
  const isVfh = form.event_type === "VFH";

  // ---- Venue booking helpers ----
  const addVenue = () => {
    setForm((f) => ({
      ...f,
      venue_bookings: [...f.venue_bookings, { venue: "", booking_status: "tentative", number_of_shows: 1, ac_start: null, ac_end: null, event_duration_minutes: null, requirements: null, notes: null, schedule_entries: [] }],
    }));
  };
  const removeVenue = (idx: number) => setForm((f) => ({ ...f, venue_bookings: f.venue_bookings.filter((_, i) => i !== idx) }));
  const updateVenue = (idx: number, patch: Partial<VenueBookingInputT>) =>
    setForm((f) => ({ ...f, venue_bookings: f.venue_bookings.map((vb, i) => (i === idx ? { ...vb, ...patch } : vb)) }));

  const addScheduleEntry = (vIdx: number) =>
    updateVenue(vIdx, {
      schedule_entries: [...(form.venue_bookings[vIdx]?.schedule_entries ?? []), { activity_type: "show", activity_date: form.event_start_date ?? "", start_time: null, end_time: null, notes: null }],
    });
  const removeScheduleEntry = (vIdx: number, sIdx: number) =>
    updateVenue(vIdx, { schedule_entries: (form.venue_bookings[vIdx]?.schedule_entries ?? []).filter((_, i) => i !== sIdx) });
  const updateScheduleEntry = (vIdx: number, sIdx: number, patch: Partial<ScheduleEntryInputT>) =>
    updateVenue(vIdx, { schedule_entries: (form.venue_bookings[vIdx]?.schedule_entries ?? []).map((se, i) => (i === sIdx ? { ...se, ...patch } : se)) });

  // ---- Requirements helpers (conditional fields) ----
  const reqs = (form.requirements ?? {}) as Record<string, unknown>;
  const setReq = (key: string, value: unknown) => update({ requirements: { ...reqs, [key]: value } });
  const loadersRequired = Boolean(reqs.loaders_required) || (typeof reqs.loaders_required === "string" && reqs.loaders_required === "Required");
  const videoRecording = Boolean(reqs.video_recording) || (typeof reqs.video_recording === "string" && reqs.video_recording === "Required");
  const pianoRequired = Boolean(reqs.piano_required) || (typeof reqs.piano_required === "string" && reqs.piano_required === "Required");
  const cateringRequired = Boolean(reqs.catering_required) || (typeof reqs.catering_required === "string" && reqs.catering_required === "Yes");
  const liquorLicence = typeof reqs.liquor_licence === "string" ? reqs.liquor_licence === "Required" : Boolean(reqs.liquor_licence);

  return (
    <div>
      <PageHeader title={isEdit ? "Edit Event" : "New Event"} subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} />

      {/* Step indicator */}
      <div className="mb-6 flex gap-1">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={"flex-1 rounded-full px-3 py-1.5 text-xs font-medium etched " + (i === step ? "bg-sage-btn text-sage-text carved-btn-sage" : i < step ? "bg-sage/10 text-sage-text" : "bg-marble-shadow/40 text-ink-muted")}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="mb-4 rounded-lg bg-status-cancelled/10 px-4 py-2 text-sm text-status-cancelled">{error}</div>}

      {/* Step 1: Event & Client */}
      {step === 0 && (
        <div className="carved-card space-y-4 rounded-2xl bg-marble-highlight/50 p-6">
          <Field label="Event Title *">
            <input type="text" value={form.title} onChange={(e) => update({ title: e.target.value })} className="carved input" />
          </Field>
          <Field label="Description">
            <textarea value={form.description ?? ""} onChange={(e) => update({ description: e.target.value || null })} className="carved input" rows={3} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Event Type">
              <select value={form.event_type ?? ""} onChange={(e) => update({ event_type: (e.target.value || null) as EventInputT["event_type"] })} className="carved input">
                <option value="">Select…</option>
                <option value="EE">EE</option>
                <option value="FR">FR (Foundation)</option>
                <option value="VFH">VFH (Venue For Hire)</option>
                <option value="Free Event">Free Event</option>
              </select>
              {isVfh && <p className="mt-1 text-[11px] text-status-awaitingApproval etched">VFH selected — approval workflow will apply.</p>}
            </Field>
            <Field label="Hiring Category">
              <input type="text" value={form.hiring_category ?? ""} onChange={(e) => update({ hiring_category: e.target.value || null })} className="carved input" />
            </Field>
            <Field label="Vertical">
              <input type="text" value={form.vertical ?? ""} onChange={(e) => update({ vertical: e.target.value || null })} className="carved input" />
            </Field>
            <Field label="Program Officer">
              <select value={form.program_officer ?? ""} onChange={(e) => update({ program_officer: e.target.value || null })} className="carved input">
                <option value="">Select…</option>
                {programOfficers.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
              </select>
            </Field>
            <Field label="Event Owner (Handled By)">
              <select value={form.event_owner ?? ""} onChange={(e) => update({ event_owner: e.target.value || null })} className="carved input">
                <option value="">Select…</option>
                {owners.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
              </select>
            </Field>
            <Field label="Enquiry Source">
              <select value={form.enquiry_source ?? ""} onChange={(e) => update({ enquiry_source: e.target.value || null })} className="carved input">
                <option value="">Select…</option>
                {sources.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
              </select>
            </Field>
            <Field label="Start Date">
              <input type="date" value={form.event_start_date ?? ""} onChange={(e) => update({ event_start_date: e.target.value || null })} className="carved input" />
            </Field>
            <Field label="End Date">
              <input type="date" value={form.event_end_date ?? ""} onChange={(e) => update({ event_end_date: e.target.value || null })} className="carved input" />
            </Field>
          </div>
          <Field label="Collaboration Details">
            <input type="text" value={form.collaboration_details ?? ""} onChange={(e) => update({ collaboration_details: e.target.value || null })} className="carved input" />
          </Field>
        </div>
      )}

      {/* Step 2: Venues & Schedule */}
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
                    <option value="cancelled">Cancelled</option>
                  </select>
                </Field>
                <Field label="Number of Shows">
                  <input type="number" min={1} value={vb.number_of_shows} onChange={(e) => updateVenue(vIdx, { number_of_shows: Number(e.target.value) })} className="carved input" />
                </Field>
                <Field label="AC Start">
                  <input type="time" value={vb.ac_start ?? ""} onChange={(e) => updateVenue(vIdx, { ac_start: e.target.value || null })} className="carved input" />
                </Field>
                <Field label="AC End">
                  <input type="time" value={vb.ac_end ?? ""} onChange={(e) => updateVenue(vIdx, { ac_end: e.target.value || null })} className="carved input" />
                </Field>
                <Field label="Duration (minutes)">
                  <input type="number" min={1} value={vb.event_duration_minutes ?? ""} onChange={(e) => updateVenue(vIdx, { event_duration_minutes: e.target.value ? Number(e.target.value) : null })} className="carved input" />
                </Field>
              </div>

              {/* Schedule entries */}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-sage etched">Schedule Entries</span>
                  <button type="button" onClick={() => addScheduleEntry(vIdx)} className="text-xs text-sage-text hover:underline">+ Add entry</button>
                </div>
                <div className="space-y-2">
                  {vb.schedule_entries.map((se, sIdx) => (
                    <div key={sIdx} className="grid grid-cols-2 items-end gap-2 md:grid-cols-5">
                      <Field label="Activity">
                        <select value={se.activity_type} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { activity_type: e.target.value as ScheduleEntryInputT["activity_type"] })} className="carved input">
                          {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
                        </select>
                      </Field>
                      <Field label="Date">
                        <input type="date" value={se.activity_date} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { activity_date: e.target.value })} className="carved input" />
                      </Field>
                      <Field label="Start">
                        <input type="time" value={se.start_time ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { start_time: e.target.value || null })} className="carved input" />
                      </Field>
                      <Field label="End">
                        <input type="time" value={se.end_time ?? ""} onChange={(e) => updateScheduleEntry(vIdx, sIdx, { end_time: e.target.value || null })} className="carved input" />
                      </Field>
                      <button type="button" onClick={() => removeScheduleEntry(vIdx, sIdx)} className="text-xs text-status-cancelled hover:underline">Remove</button>
                    </div>
                  ))}
                  {vb.schedule_entries.length === 0 && <p className="text-xs text-ink-muted etched">No schedule entries yet. Add setup, rehearsal, show, dismantling, or technical meeting dates.</p>}
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addVenue} className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched">+ Add another venue</button>
        </div>
      )}

      {/* Step 3: Requirements (with conditional fields) */}
      {step === 2 && (
        <div className="space-y-4">
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Sound</h3>
            <Field label="Sound Requirements">
              <textarea value={(reqs.sound as string) ?? ""} onChange={(e) => setReq("sound", e.target.value || null)} className="carved input" rows={2} />
            </Field>
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
            </div>
          </section>
          <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Recording & Special</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Video Recording">
                <YesNoSelect value={(reqs.video_recording as string) ?? ""} onChange={(v) => setReq("video_recording", v || null)} />
              </Field>
              {videoRecording && (
                <Field label="No. of Cameras (conditional)">
                  <input type="number" min={0} value={(reqs.camera_count as string) ?? ""} onChange={(e) => setReq("camera_count", e.target.value || null)} className="carved input" />
                </Field>
              )}
              <Field label="Piano Required">
                <input type="text" placeholder="e.g. Yamaha Grand" value={(reqs.piano_required as string) ?? ""} onChange={(e) => setReq("piano_required", e.target.value || null)} className="carved input" />
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
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Catering</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Catering Required">
                <YesNoSelect value={(reqs.catering_required as string) ?? ""} onChange={(v) => setReq("catering_required", v || null)} yesValue="Yes" noValue="No" />
              </Field>
              {cateringRequired && (
                <>
                  <Field label="Catering Provider (conditional)">
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
            </div>
          </section>
        </div>
      )}

      {/* Step 4: Documents — placeholder (Phase 7 R2 upload) */}
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
            <ReviewItem label="Title" value={form.title} />
            <ReviewItem label="Type" value={form.event_type} />
            <ReviewItem label="Program Officer" value={form.program_officer} />
            <ReviewItem label="Owner" value={form.event_owner} />
            <ReviewItem label="Dates" value={form.event_start_date ? `${form.event_start_date}${form.event_end_date ? " → " + form.event_end_date : ""}` : null} />
            <ReviewItem label="Venues" value={`${form.venue_bookings.length} booking(s): ${form.venue_bookings.map((v) => v.venue || "(unset)").join(", ")}`} />
            <ReviewItem label="Schedule entries" value={`${form.venue_bookings.reduce((acc, vb) => acc + vb.schedule_entries.length, 0)} total`} />
            <ReviewItem label="VFH approval" value={isVfh ? "Will apply (VFH)" : "Not applicable"} />
          </dl>
          {form.notes !== null && (
            <Field label="Notes">
              <textarea value={form.notes ?? ""} onChange={(e) => update({ notes: e.target.value || null })} className="carved input" rows={2} placeholder="Event-level notes…" />
            </Field>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="carved-btn rounded-full bg-neutral-btn px-5 py-2 text-sm font-medium text-ink-secondary etched disabled:opacity-40"
        >
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.title.trim() || !form.venue_bookings[0]?.venue.trim()}
            className="carved-btn-sage rounded-full bg-sage-btn px-5 py-2 text-sm font-semibold text-sage-text etched disabled:opacity-60"
          >
            {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Create event"}
          </button>
        )}
      </div>

      <style>{`.carved.input { width:100%; border-radius:12px; background:rgba(244,244,242,0.4); padding:8px 14px; font-size:14px; color:#5C5850; outline:none; }`}</style>
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
