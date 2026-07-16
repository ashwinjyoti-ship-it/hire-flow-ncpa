# Operations checklist rethink

## Simple proposal

Treat the Operations tab as one guided flow:

1. **Action checklist** — things the team must do until Technical Meeting / Minutes.
2. **Event form completeness checklist** — information that must be filled before the event starts.
3. **Post-event closure** — actions after the show.
4. Then the user moves to the **Accounts** tab.

This keeps the familiar checklist feeling, but stops the checklist from becoming a duplicate data-entry form.

## What I think of the suggested UI

Your suggested UI is the right direction.

The team is already used to checklist-style working, so event-form completeness should still look like a checklist with checkboxes. In this part of the app, the checkboxes should be **fully automated**, not manually ticked. The event form remains the manual input area; the Operations checklist and completeness rows simply read that event-form data and update themselves.

The colour-progress idea is also useful because some sections are not simply yes/no. Catering is the best example: if catering is required, the team may need caterer type, caterer name, meal type, pax, timing, venue rules, and other details. A single checkbox would hide that partial progress. A colour transition makes it obvious that the section is improving but not done yet.

One improvement I would add: use both **colour and text**, not colour alone. For example:

```text
🟠 Catering — 4 of 7 details filled
```

This helps on iPad screens, in bright light, and for users who may not notice subtle colour differences.

## Operations tab layout

### 1. Action checklist: before Technical Meeting / Minutes

Keep only identification and action-oriented rows here:

- Event reference: Event name, event date, venue, event type.
- Approval follow-up, only when approval is required.
- Costing email / proforma / payment status, because these affect confirmation.
- Confirmation letter made, sent, signed received.
- NOC sent, when applicable.
- OnStage / Emailer follow-up actions.
- Monthly chart sent.
- Technical meeting date and minutes sent.

Remove Point of Contact from the Operations checklist. POC remains compulsory in the event form and should continue to block confirmation where required.

### 2. Event form completeness checklist

After Technical Meeting / Minutes, show a two-column completeness checklist.

Suggested columns:

| Item | Status |
| --- | --- |
| Technical / sound | 🟡 60% — 3 of 5 filled |
| Catering | 🟠 40% — 4 of 10 filled |
| Licences | ✅ Complete |
| House seats / crew cards | 🔴 Missing |

Each row has:

- A checkbox.
- A section name.
- A colour state.
- A simple progress count.
- A direct link to open the relevant part of the event form.

The checkbox behaviour should be:

- Empty when nothing required is filled.
- Partially filled / coloured when some information is present.
- Ticked when all required information for that section is complete.
- Immediately ticked for sections with only one required field once that field is entered.
- Marked Not Applicable where the section does not apply.

### 3. Colour states

Use colours approximately like this:

- 🔴 Red: required section has no useful information yet.
- 🟠 Orange: some information exists, but important details are missing.
- 🟡 Yellow: mostly filled, only small details missing.
- 🟢 Green: complete.
- ⚪ Grey: not applicable.

The row should slowly move from red to green as fields are filled in the event form. This should be more pronounced for larger sections like Catering, Technical / Sound, Staffing, Recording, Decorator, and Facilities.

### 4. Post-event closure

After event-form completeness, keep post-event closure as action checklist rows:

- Feedback form sent / received.
- Event report.
- Box office statement.
- Final closure notes where needed.
- Send file to accounts where relevant.

After this, the user naturally moves to the Accounts tab.

## What moves out of Operations checklist data-entry rows

Move these to the event form only, with no duplicate checklist row:

- Sound requirement and sound costing details.
- Crew cards.
- House seats.
- Licences and licence types.
- Decorator details.
- Catering details.
- Staffing, facilities, recording, special requirements, and other operational data.

These should appear in Operations only as completeness checklist status, not as editable checklist fields.

## Event readiness panel

Keep the Event readiness panel idea. It should sit at the top of the event page and also appear in compact form on task cards.

Suggested display:

```text
Event readiness: 72%
Before confirmation: 2 blockers
Before event: 5 details missing

Missing before event
- Technical / sound: Mic list, console requirement
- Catering: Meal type, pax, service timing
- Operations: House seats, crew cards
```

This panel gives managers the quick answer: “Can this event safely move forward?”

## New task philosophy

Tasks should follow the event form, not force users through a rigid step-by-step sequence.

Instead of one task per tiny field, create one smart task per incomplete event-form section.

Example task titles:

- Complete event form: Technical / sound details missing.
- Complete event form: Licences and house seats missing.
- Complete event form: Catering / decorator details missing.
- Complete event form: Client contact and billing details missing.

A task should automatically update as the event form changes. If ten missing catering fields become three missing fields, the task text should shrink. If the section becomes complete, the task should check itself off.

## Event form default-state philosophy

For this automation to work cleanly, every event-form field needs a clear starting state. The system must be able to tell the difference between:

1. **Unknown / not filled yet** — nobody has answered this field.
2. **Negative / not required / no** — the team has actively said this does not apply.
3. **Positive / required / yes** — the team has actively said this applies and may need more details.

My recommendation: almost no event-form field should default to a positive value. A positive default can make the system think the team has made a decision when they have not.

### Recommended defaults

Use these rules:

| Field type | Default state | Why |
| --- | --- | --- |
| Text, date, number, notes | Empty | Empty clearly means not filled yet. |
| Required yes/no questions | Empty / Select | Forces the user to make an intentional choice. |
| Optional yes/no questions | Empty / Select, or `No` only if NCPA policy truly assumes No | Avoids false positives. |
| Status fields | `Not started`, `Pending`, or `Not received` | These are negative workflow states, not positive completion. |
| Not-applicable choices | Do not default unless policy is universal | `Not applicable` should usually be a user decision or a rule-based result. |
| Computed readiness fields | Calculated by system | Users should not edit these. |

### Empty vs negative

Use **empty** when the user has not answered yet. Example: `Meal type`, `Pax`, `Caterer name`, `Technical meeting date`.

Use a **negative default** only when the field represents a workflow status that definitely starts negative. Example: `Payment status = Incomplete`, `Confirmation signed received = No`, `Minutes sent = No`, `Feedback received = No`.

Use **positive** only after the user enters data or explicitly selects Yes / Received / Complete. The system should not assume a positive state by default.

### Example: Catering

Catering should not start as `Yes`. It should start as empty / undecided.

Once the user selects `Catering required = Yes`, then the catering detail fields become required and the completeness row begins counting them:

```text
Catering required = Yes
Caterer type = empty
Caterer name = filled
Meal type = empty
Pax = filled

Operations completeness: 🟠 Catering — 2 of 4 details filled
```

If the user selects `Catering required = No`, the Catering row becomes grey / Not Applicable and should not create missing-data tasks.

### Why this matters

This default-state policy prevents fake progress. The app should only turn rows green when the team has actually entered information or made a deliberate decision.


## Current event-form audit findings

Before coding the new readiness system, audit the event form defaults in `src/lib/event-edit-form.ts`. The current code already has a helper called `createDefaultVenueRequirements()`, but it was built for the old philosophy. It pre-fills many event-form dropdowns with negative values so the old Operations checklist could sync immediately.

That old approach is not ideal for the new readiness model. For readiness automation, the system must know whether the user actually answered a field or whether the app filled a default.

### Current issues to fix

1. Several event-form decision fields currently default to negative values such as `No` or `Not Required`. Examples include catering required, decorator required, video recording, piano required, liquor licence, interval, and meal-required fields.
2. `orchestra_pit_chairs` currently defaults to `Keep`, which is a positive/active value. This should not be a default because it can create fake progress.
3. `licenses_status` currently defaults to `Not required`, but this should be blank. The user must intentionally choose `Required` or `Not required` because both states happen in real events.
4. `vendor_registration_form` can remain `Not Applicable` by default because that is acceptable policy for this field. If the current stored label is `No Applicable`, clean the wording to `Not Applicable`.
5. Text/date/number fields are mostly safe because they naturally start empty, but the audit should confirm every required readiness field has a clear empty state.

### Required coding audit

When implementation starts, make a simple field-default audit table for every event-form requirement field:

| Field | Current default | New default | State category | Notes |
| --- | --- | --- | --- | --- |
| catering_required | No | empty/select | Unknown until answered | Yes activates catering details; No marks Not Applicable. |
| decorator_required | No | empty/select | Unknown until answered | Yes activates decorator details; No marks Not Applicable. |
| orchestra_pit_chairs | Keep | empty/select | Unknown until answered | User must choose Keep or Remove; default should be blank. |
| licenses_status | Not required | empty/select | Unknown until answered | User must choose Required or Not required; neither is default. |
| vendor_registration_form | No Applicable | Not Applicable | Not required by default | This may remain defaulted; clean label if needed. |

The audit should classify every field into one of these states:

- **Unknown** — not answered yet.
- **Not yet** — a workflow item is pending.
- **Not required** — user or rule says it does not apply.
- **Positive / Required / Yes** — user has actively said it applies.
- **Complete** — required details are filled.

### Default-state decision

My recommendation is:

- Event-form requirement decision fields should mostly start as **Unknown**.
- Workflow/action status fields can start as **Not yet** or **Pending**.
- No event-form field should start **Positive / Required / Yes** unless there is a strict NCPA policy that makes it always true.
- `No` and `Not required` should usually be user decisions, not silent defaults.
- `orchestra_pit_chairs` must start blank; the state change is the user selecting `Keep` or `Remove`.
- `licenses_status` must start blank; the state change is the user selecting `Required` or `Not required`.
- `vendor_registration_form` may remain defaulted to `Not Applicable`.

This is the key change needed before automated checklist ticks, colour progress, and task generation are reliable.

## Timing rules

Keep the existing checklist interval settings for action follow-ups:

- Approval follow-up.
- Confirmation letter follow-up.
- Technical meeting follow-up.
- Accounts follow-up.
- TDS follow-up.
- Instalment follow-up.
- OnStage follow-up.
- Feedback follow-up.
- Send file to accounts follow-up.

Do not add artificial interval settings for operational data. Operational data has one deadline: it must be complete before the event starts.

## Confirmation criteria

Do not weaken the current confirmation rules. Confirmation should still require:

- Required approval completed, when applicable.
- POC and billing basics completed in the event form.
- Costing email and payment requirements satisfied according to the current policy.
- Confirmation letter process tracked as an action.

The change is only where information is tracked, not whether the information is required.

## Reports

Reports should show two separate measures:

1. **Action progress** — checklist actions completed / pending.
2. **Event-form readiness** — required form information completed / missing.

This makes reports clearer: managers can see whether a team is slow because actions are pending, or because client/event information has not yet been collected.

## Manual sheet correlation and improvement

The current manual sheet mixes three kinds of rows:

- Basic identity: Event name, date, venue, contact, event type.
- Actions: Costing email, proforma invoice, payment received, confirmation letter, NOC, technical meeting, minutes, final invoice, refund, feedback, TDS.
- Data to capture: Sound requirement, sound costing, house seats, licences.

The improved app should preserve the useful simplicity of the sheet but separate the meaning of each row:

- Identity stays visible at the top so the team knows which event they are working on.
- Actions stay in the checklist because someone must do them.
- Data lives in the event form because that is where structured event information belongs.
- Event-form completeness appears as a checklist-style progress layer, so the team still gets the satisfaction and clarity of ticking things off.


## Visual theme requirement

Maintain the existing app theme. The UI should continue to feel like a marble stone surface where the interface is etched, carved, or engraved out of the material.

For the new Operations checklist and readiness UI:

- Do not introduce a visually separate dashboard style.
- Keep panels, rows, checkboxes, progress indicators, and status chips consistent with the marble/etched design language.
- Colour states should feel like subtle inlaid or stained accents on the stone, not bright plastic badges.
- The red/orange/yellow/green/grey readiness colours should be readable, but still restrained and premium.
- The two-column completeness checklist should look like it belongs to the existing app: carved rows, soft shadows, engraved dividers, and calm typography.
- The Event readiness panel should feel like a polished stone plaque, not a modern SaaS widget pasted on top.

In short: preserve the current NCPA visual identity first; add readiness clarity inside that theme.

## Build plan

1. Rename the current Operations checklist experience to focus on actions.
2. Remove duplicate data-entry rows from Operations checklist definitions.
3. Keep POC in the event form and remove it from the Operations checklist.
4. Audit every event-form requirement field against the state model: Unknown, Not yet, Not required, Positive / Required / Yes, and Complete.
5. Fix defaults in `createDefaultVenueRequirements()` / event-form setup so decision fields start Unknown unless NCPA policy requires a negative default.
6. Specifically set `orchestra_pit_chairs` to blank until the user selects Keep or Remove.
7. Specifically set `licenses_status` to blank until the user selects Required or Not required.
8. Keep `vendor_registration_form` defaulted to Not Applicable, cleaning the label if needed.
9. Remove any other positive defaults unless they are truly policy-driven.
10. Add event-form completeness definitions by section, including required fields and not-applicable rules.
11. Add the two-column completeness checklist after Technical Meeting / Minutes and before Post-event Closure.
12. Add colour/progress states: red, orange, yellow, green, grey.
13. Make completeness checkboxes fully automated from event-form data.
14. Add direct links from each completeness row to the relevant event-form section.
15. Generate/update one auto task per incomplete section, due before the event start.
16. Auto-complete readiness tasks when their section becomes complete.
17. Show readiness percentage and missing sections on event cards, event detail, task cards, and reports.
18. Keep the current confirmation gate, but source data blockers from the event form instead of duplicate checklist fields.
