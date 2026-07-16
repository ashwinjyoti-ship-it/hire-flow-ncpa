# Event-form requirement default audit

The readiness model treats blank as **Unknown**, an explicit negative answer as **Not required**, a workflow status as **Not yet**, and affirmative answers as **Positive / Required / Yes**. New venue requirement records therefore start empty. Existing saved decisions are preserved because the application cannot reliably distinguish an old silent default from an intentional user choice.

| Field(s) | Previous default | New default | State category | Notes |
| --- | --- | --- | --- | --- |
| `green_rooms_required`, `ushers_required`, `loaders_required` | Not Required | empty/select | Unknown | A user chooses Required or Not Required. Conditional detail is counted only when Required. |
| `house_seats_release` | No | empty/select | Unknown | Yes activates house-ticket type. |
| `video_recording`, `piano_required` | No | empty/select | Unknown | Yes activates camera/recording or tuning details. |
| `liquor_licence` | Not Required | empty/select | Unknown | Required activates licence details. |
| `catering_required` | No | empty/select | Unknown | Yes activates caterer, interval, meal decisions, and pax. No marks Catering Not Applicable. |
| `catering_*_required` | No | empty/select | Unknown | Each meal decision is intentional; Yes activates pax. |
| `interval` | No | empty/select | Unknown | Counted only when catering applies. |
| `decorator_required` | No | empty/select | Unknown | Yes activates decorator name. No marks Decorator Not Applicable. |
| `orchestra_pit_chairs` | Keep | empty/select | Unknown | User must choose Keep or Remove. |
| `digital_standee`, `car_display`, `bike_display`, `stalls`, `telecasting_media` | No | empty/select | Unknown | Yes activates the matching detail field. |
| `licenses_status` | Not required | empty/select | Unknown | User chooses Required, Awaiting, Received, or Not required; applicable states activate licence types. |
| Text, time, date, number, and notes fields | empty | empty | Unknown | They count only when entered and applicable. |
| `vendor_registration_form` | No Applicable | Not Applicable | Not required by policy | This is the sole event-form policy default; the label is corrected. |
| Checklist workflow fields | negative workflow values | unchanged | Not yet | Payment, confirmation, Minutes, feedback, and similar action states remain negative until completed. |

No event-form requirement begins Positive / Required / Yes. Readiness is calculated by `worker/lib/event-readiness.ts` and is not user-editable.
