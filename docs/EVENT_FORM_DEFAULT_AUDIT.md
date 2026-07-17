# Event-form requirement default audit

## Optional sub-rows: N/A and Yes only

For meals, staffing toggles, recording options, and additional add-ons, the event form shows **N/A** (default) and **Yes** / **Required** / **Keep** only. There is no separate **No** option in the UI.

**Documentation convention: N/A = No.** Any legacy stored value of `No`, `Not Required`, or `Remove` is treated the same as N/A for readiness, lifecycle tasks, and display. Existing saved events keep working; the dropdown shows N/A for those rows.

Parent section gates (`catering_required`, `decorator_required`, etc.) still use **Yes / No** because the team must decide whether the whole section applies.

The readiness model treats blank optional rows as **N/A (not required)**. Affirmative answers require details (pax, notes, call times). Workflow checklist fields remain unchanged.

| Field(s) | UI options | Documented meaning | Lifecycle |
| --- | --- | --- | --- |
| `catering_*_required` | N/A, Yes | N/A = not needed; Yes = need pax | Gap only if Yes without pax |
| `green_rooms_required`, `ushers_required`, `loaders_required` | N/A, Required | N/A = No | Gap only if Required without details |
| `house_seats_release` | N/A, Yes | N/A = No | Gap only if Yes without ticket type |
| `video_recording`, `piano_required` | N/A, Yes | N/A = No | Gap only if Yes without details |
| `liquor_licence` | N/A, Required | N/A = No | Gap only if Required without details |
| `digital_standee`, `car_display`, `bike_display`, `stalls`, `telecasting_media` | N/A, Yes | N/A = No | Gap only if Yes without notes |
| `orchestra_pit_chairs` | N/A, Keep | N/A = No / Remove | Not in add-ons rollup |
| `catering_required`, `decorator_required` | Yes, No (section gate) | No = whole section N/A | Section not_applicable |
| `interval` | Yes, No | Counted when catering applies | Required field when catering Yes |
| `licenses_status` | Select (incl. Not required) | Standard licence workflow | Required when applicable |
| Text, time, date, number, notes | empty | Unknown until entered | Count when applicable |
| `vendor_registration_form` | Not Applicable (policy default) | Not required by policy | — |
| Checklist workflow fields | negative workflow values | Not yet | Unchanged |

Readiness is calculated by `worker/lib/event-readiness.ts` and is not user-editable.
