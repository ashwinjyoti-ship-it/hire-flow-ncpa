import {
  CATERING_MEAL_TYPES,
  cateringMealPaxKey,
  cateringMealRequiredKey,
} from "../../../worker/lib/catering-meals";
import { useLookups } from "../../lib/use-lookups";

type RequirementsValue = Record<string, unknown>;

type RequirementsFieldsProps = {
  value: RequirementsValue;
  onChange: (next: RequirementsValue) => void;
};

function isYes(v: unknown, yesValue = "Required"): boolean {
  return v === yesValue || v === "Yes";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-sage etched">{label}</span>
      {children}
    </label>
  );
}

function YesNoSelect({
  value,
  onChange,
  yesValue = "Required",
  noValue = "Not Required",
}: {
  value: string;
  onChange: (v: string) => void;
  yesValue?: string;
  noValue?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="carved input">
      <option value="">Select…</option>
      <option value={noValue}>{noValue}</option>
      <option value={yesValue}>{yesValue}</option>
    </select>
  );
}

/** Venue-scoped requirements fields (same set for every venue booking). */
export function RequirementsFields({ value, onChange }: RequirementsFieldsProps) {
  const { data: lookups } = useLookups();
  const reqs = value ?? {};
  const setReq = (key: string, nextValue: unknown) => onChange({ ...reqs, [key]: nextValue });

  const loadersRequired = isYes(reqs.loaders_required);
  const videoRecording = isYes(reqs.video_recording, "Yes");
  const pianoRequired = isYes(reqs.piano_required);
  const cateringRequired = isYes(reqs.catering_required, "Yes");
  const decoratorRequired = isYes(reqs.decorator_required, "Yes");
  const liquorLicence = isYes(reqs.liquor_licence);

  return (
    <div className="space-y-4">
      <section className="carved-card rounded-2xl bg-marble-highlight/50 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-sage etched">Sound</h3>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
          <Field label="Sound Requirements">
            <textarea value={(reqs.sound as string) ?? ""} onChange={(e) => setReq("sound", e.target.value || null)} className="carved input" rows={2} />
          </Field>
          <Field label="Sound Call Time">
            <input type="time" lang="en-GB" value={(reqs.sound_call_time as string) ?? ""} onChange={(e) => setReq("sound_call_time", e.target.value || null)} className="carved input" />
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
            <input type="time" lang="en-GB" value={(reqs.light_call_time as string) ?? ""} onChange={(e) => setReq("light_call_time", e.target.value || null)} className="carved input" />
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
            <input type="time" lang="en-GB" value={(reqs.ushers_call_time as string) ?? ""} onChange={(e) => setReq("ushers_call_time", e.target.value || null)} className="carved input" />
          </Field>
          <Field label="Loaders Required">
            <YesNoSelect value={(reqs.loaders_required as string) ?? ""} onChange={(v) => setReq("loaders_required", v || null)} />
          </Field>
          {loadersRequired && (
            <Field label="Loaders Call Time (conditional)">
              <input type="time" lang="en-GB" value={(reqs.loaders_call_time as string) ?? ""} onChange={(e) => setReq("loaders_call_time", e.target.value || null)} className="carved input" />
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
              <input type="time" lang="en-GB" value={(reqs.piano_tuning_time as string) ?? ""} onChange={(e) => setReq("piano_tuning_time", e.target.value || null)} className="carved input" />
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
              <Field label="Interval (conditional)">
                <YesNoSelect value={(reqs.interval as string) ?? ""} onChange={(v) => setReq("interval", v || null)} yesValue="Yes" noValue="No" />
              </Field>
              {CATERING_MEAL_TYPES.map((meal) => {
                const requiredKey = cateringMealRequiredKey(meal.key);
                const paxKey = cateringMealPaxKey(meal.key);
                const mealRequired = isYes(reqs[requiredKey], "Yes");
                return (
                  <div key={meal.key} className="contents">
                    <Field label={meal.label}>
                      <YesNoSelect
                        value={(reqs[requiredKey] as string) ?? ""}
                        onChange={(v) => {
                          const next = { ...reqs, [requiredKey]: v || null };
                          if (v !== "Yes") next[paxKey] = null;
                          onChange(next);
                        }}
                        yesValue="Yes"
                        noValue="No"
                      />
                    </Field>
                    {mealRequired && (
                      <Field label={`${meal.label} — No. of Pax`}>
                        <input
                          type="number"
                          min={0}
                          value={(reqs[paxKey] as string) ?? ""}
                          onChange={(e) => setReq(paxKey, e.target.value || null)}
                          className="carved input"
                        />
                      </Field>
                    )}
                  </div>
                );
              })}
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
        <div className="mb-4">
          <Field label="Stage Setup">
            <textarea
              value={(reqs.stage_setup as string) ?? ""}
              onChange={(e) => setReq("stage_setup", e.target.value || null)}
              className="carved input"
              rows={3}
              placeholder="Props, curtains, cyclorama, backstage tables, technicians…"
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Field label="Orchestra Pit Chairs">
              <YesNoSelect value={(reqs.orchestra_pit_chairs as string) ?? ""} onChange={(v) => setReq("orchestra_pit_chairs", v || null)} yesValue="Keep" noValue="Remove" />
            </Field>
            <Field label="Orchestra Pit Chairs — notes">
              <input type="text" value={(reqs.orchestra_pit_chairs_note as string) ?? ""} onChange={(e) => setReq("orchestra_pit_chairs_note", e.target.value || null)} className="carved input" placeholder="Qty or other notes…" />
            </Field>
          </div>
          <div className="space-y-2">
            <Field label="Digital Standee">
              <YesNoSelect value={(reqs.digital_standee as string) ?? ""} onChange={(v) => setReq("digital_standee", v || null)} yesValue="Yes" noValue="No" />
            </Field>
            <Field label="Digital Standee — notes">
              <input type="text" value={(reqs.digital_standee_note as string) ?? ""} onChange={(e) => setReq("digital_standee_note", e.target.value || null)} className="carved input" />
            </Field>
          </div>
          <div className="space-y-2">
            <Field label="Car Display">
              <YesNoSelect value={(reqs.car_display as string) ?? ""} onChange={(v) => setReq("car_display", v || null)} yesValue="Yes" noValue="No" />
            </Field>
            <Field label="Car Display — notes">
              <input type="text" value={(reqs.car_display_note as string) ?? ""} onChange={(e) => setReq("car_display_note", e.target.value || null)} className="carved input" />
            </Field>
          </div>
          <div className="space-y-2">
            <Field label="Bike Display">
              <YesNoSelect value={(reqs.bike_display as string) ?? ""} onChange={(v) => setReq("bike_display", v || null)} yesValue="Yes" noValue="No" />
            </Field>
            <Field label="Bike Display — notes">
              <input type="text" value={(reqs.bike_display_note as string) ?? ""} onChange={(e) => setReq("bike_display_note", e.target.value || null)} className="carved input" />
            </Field>
          </div>
          <div className="space-y-2">
            <Field label="Stalls">
              <YesNoSelect value={(reqs.stalls as string) ?? ""} onChange={(v) => setReq("stalls", v || null)} yesValue="Yes" noValue="No" />
            </Field>
            <Field label="Stalls — notes">
              <input type="text" value={(reqs.stalls_note as string) ?? ""} onChange={(e) => setReq("stalls_note", e.target.value || null)} className="carved input" placeholder="No. of stalls…" />
            </Field>
          </div>
          <div className="space-y-2">
            <Field label="Telecasting / Media">
              <YesNoSelect value={(reqs.telecasting_media as string) ?? ""} onChange={(v) => setReq("telecasting_media", v || null)} yesValue="Yes" noValue="No" />
            </Field>
            <Field label="Telecasting / Media — notes">
              <input type="text" value={(reqs.telecasting_media_note as string) ?? ""} onChange={(e) => setReq("telecasting_media_note", e.target.value || null)} className="carved input" />
            </Field>
          </div>
        </div>
      </section>
    </div>
  );
}
