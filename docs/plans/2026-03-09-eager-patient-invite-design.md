# Eager patient invite generation design

This document defines the backend and client changes required to make a
patient meeting join link available immediately after an appointment is
created. The goal is simple: when staff creates an appointment, the patient
app must show a usable **Join** action right away without requiring a doctor
or admin to first click **Copy patient link**.

The current system does not meet that goal because patient invite generation is
explicit and on-demand. The meeting list returns `patient_invite_url=null`
until a doctor, admin, or patient explicitly requests an invite. This document
changes that behavior for appointment creation while keeping short-lived video
tokens and the current presence model.

## Problem statement

Today, the flow is split across two contracts:

- `GET /patient-app/me/meetings` is read-only and never creates an invite.
- `POST /meetings/{meeting_id}/video/patient-invite` and
  `POST /patient-app/me/meetings/{meeting_id}/invite` create or refresh the
  patient invite on demand.

That split causes an undesirable user experience:

1. Staff creates a meeting.
2. The meeting appears in doctor and patient systems.
3. The patient app still sees no `patient_invite_url`.
4. The patient card renders a disabled state such as
   "กำลังเตรียมห้อง".
5. Staff must manually create the link by copying it first, or the patient
   must rely on a fallback request when tapping join.

The design goal is to remove step 5 from the normal workflow.

## Decision

The system will generate a patient invite eagerly when a joinable meeting is
created for a patient. The generated short link becomes the canonical patient
join URL for that meeting.

The system will keep the existing explicit invite endpoints, but they will
change role:

- They remain valid fallback and refresh endpoints.
- They no longer represent the primary path for first-time invite creation.

This design intentionally separates the stable patient join link from the
short-lived video token:

- The patient short link is long-lived and tied to the appointment lifecycle.
- The video token remains short-lived and is minted only when the patient
  actually enters the room.

## Goals and non-goals

This design focuses on making join availability immediate after meeting
creation while preserving the current security model for video access.

### Goals

- Show a patient join action immediately after appointment creation.
- Remove the need for staff to manually create the first patient link.
- Keep video access protected by short-lived tokens.
- Preserve current presence heartbeat and status reconciliation behavior.
- Keep fallback invite refresh endpoints for recovery and backward
  compatibility.

### Non-goals

- Replacing HTTP polling with WebSocket or push delivery.
- Redesigning the patient waiting room state machine.
- Introducing a new meeting provider or new auth model.
- Changing the short-lived token exchange flow after a patient taps join.

## Recommended approach

This design chooses eager invite generation at meeting creation time.

Two alternatives were considered and rejected:

- Generate the invite only near the scheduled appointment time.
  This reduces long-lived invite exposure, but it does not satisfy the
  requirement that the patient can join as soon as the appointment is created.
- Keep invite generation fully explicit, but let the patient app silently
  request one when the patient taps join.
  This avoids backend changes in create flow, but the patient UI still lacks an
  immediately available link snapshot and still depends on a recovery call in
  the critical path.

## Target behavior

After this change, the expected workflow is:

1. Staff creates a meeting with a patient attached.
2. Backend creates the meeting row.
3. Backend creates or assigns the canonical patient short link for that
   meeting.
4. Backend returns the meeting payload with `patient_invite_url`.
5. Doctor UI can show that the patient link is ready.
6. Patient app sees the invite URL in `GET /patient-app/me/meetings`.
7. Patient taps **Join** at any time and exchanges invite proof for a
   short-lived video token.

The patient may open the appointment before the doctor joins. That is allowed.
Presence and meeting status continue to move only when the patient actually
enters the room and the app sends token exchange and heartbeat calls.

## Architecture changes

The system keeps the existing REST shape, but the invite lifecycle changes from
"explicit first issue" to "eager initial issue, explicit refresh later."

### Backend meeting flow

The backend meeting service becomes responsible for patient invite bootstrap.

- On `create_meeting`, if `meeting.user_id` exists and the meeting status is
  joinable, generate a patient invite immediately.
- On `update_meeting`, apply these rules:
  - If the patient changes, revoke old active invite codes for that meeting and
    generate a new canonical invite for the new patient.
  - If only date, note, description, or room changes, keep the same invite.
  - If status changes to `cancelled` or `completed`, stop treating the invite
    as active and hide it from patient lists.
- On `delete_meeting`, rely on existing delete cascade and cleanup rules.

This work belongs in the backend service layer, not in the API router, because
invite generation is business logic, not transport logic.

### Invite lifecycle

The system must stop treating the patient short link like a 24-hour artifact if
appointments are often scheduled days in advance.

The short link policy becomes:

- The canonical patient short link remains valid for the lifecycle of a
  joinable appointment.
- The link becomes invalid when the meeting is cancelled, completed, deleted,
  or reassigned to another patient.
- The signed video token remains short-lived and is still issued only during
  join.

This preserves security where it matters most. Possessing the short link is not
enough to join media forever. The short link only lets the client request fresh
join proof according to backend validation rules.

### Patient list contract

The patient meeting list remains read-only, but it changes from "invite may be
missing until explicitly created" to "invite is normally already present."

`GET /patient-app/me/meetings` continues to:

- return the meeting snapshot,
- never mutate invite state,
- hide inactive invites for cancelled or completed meetings,
- expose `patient_invite_url` and `patient_invite_expires_at`.

The practical difference is that most joinable meetings now already have a
ready invite snapshot.

### Doctor UI contract

Doctor-facing meeting payloads should also expose the patient invite URL so the
UI can reflect the new state immediately after create or update.

`MeetingOut` should include:

- `patient_invite_url`

Optionally, for clarity and future UI logic, it may also include:

- `patient_invite_ready`
- `patient_invite_expires_at`

The minimum required field for this change is `patient_invite_url`.

## Data model changes

The existing schema already contains `meetings.patient_invite_url` and the
`meeting_patient_invite_codes` table. No new table is required for the first
version of this design.

The implementation should prefer these rules:

- Keep using `meeting_patient_invite_codes` as the source of active short codes.
- Keep `meetings.patient_invite_url` as the current canonical snapshot for
  fast reads and response serialization.
- Reuse the most recent active short code for the meeting when possible.
- Create a new short code only when no active code exists or when patient
  reassignment invalidates the old code.

If the current invite code TTL is too short for appointment scheduling
patterns, the implementation must update that policy. There are two safe
options:

1. Set invite code expiration relative to meeting lifecycle instead of a fixed
   24-hour TTL.
2. Keep expiry, but automatically rotate to a fresh active code during
   appointment update or background maintenance.

This design recommends option 1 because it aligns with the requirement that the
link is available immediately after creation and stays usable until the
appointment is no longer joinable.

## Detailed backend changes

The backend implementation should touch the following areas.

### `backend/app/services/meeting.py`

This service owns create and update behavior today. It should orchestrate eager
invite generation.

Changes:

- After persisting a new meeting, if the meeting is joinable and has a patient,
  call the patient invite service.
- After updating a meeting, compare old and new patient and status values
  before deciding whether to reuse, regenerate, or deactivate the invite.
- Return the reloaded meeting with any new `patient_invite_url` relationship
  data serialized through schema.

### `backend/app/services/meeting_video.py`

This service already knows how to create patient invites. It should gain a
small orchestration helper for eager generation and reuse.

Changes:

- Add a helper that ensures a canonical active invite exists for a joinable
  meeting.
- Add a helper that invalidates active invite codes for a meeting when patient
  ownership changes or the meeting becomes terminal.
- Keep `create_patient_join_invite()` as the low-level generator.

### `backend/app/services/patient_app.py`

This service can remain read-only for patient meeting list reads. It only needs
to correctly surface the eagerly created invite snapshot.

Changes:

- No new side effects on list reads.
- Continue to prefer active invite code lookup.
- Return the canonical URL for joinable meetings whenever an active code
  exists.

### `backend/app/schemas/meeting.py`

Doctor-facing meeting responses need enough data for the dashboard to know the
patient link is ready.

Changes:

- Add `patient_invite_url` to `MeetingOut`.
- Optionally add `patient_invite_expires_at` if the doctor UI needs visibility
  into expiry.

### `backend/app/api/meetings.py`

Routers should stay thin.

Changes:

- No custom router-side invite logic is required beyond calling updated service
  methods.
- Keep explicit invite endpoints for compatibility and recovery.

## Client changes

This design affects both the doctor web app and the patient mobile app.

### Doctor web app

The doctor UI should stop treating **Copy patient link** as the action that
creates the first link.

Changes:

- After create or update, the meeting payload already contains
  `patient_invite_url`.
- The **Copy patient link** action should copy the existing URL when present.
- If the URL is unexpectedly missing, the UI may call the explicit invite
  endpoint as a fallback and then cache the result.
- Meeting detail UI should show that patient room access is ready immediately
  after appointment creation.

This keeps the existing action but changes it from "generate and copy" to
"copy, with refresh fallback."

### Patient mobile app

The patient app already has the logic to join when `patient_invite_url` exists.
Its main issue is that the list often arrives with no invite snapshot.

Changes:

- No major join-flow redesign is required.
- The existing fallback that calls `POST /patient-app/me/meetings/{id}/invite`
  stays in place for stale or missing links.
- The primary list state for joinable meetings should now be an active **Join**
  button instead of **Preparing room**.

This is a low-risk mobile change because the app already understands active
invites and already knows how to recover from stale invite proof.

## Edge cases

This change introduces a few lifecycle decisions that must be explicit.

### Meeting created without patient

If staff creates a meeting without a patient attached, the backend must not
generate an invite. The invite is created only after a patient is assigned.

### Patient reassignment

If a meeting changes from patient A to patient B:

- patient A's active invite codes for that meeting must no longer work,
- `meetings.patient_invite_url` must point to the new canonical invite,
- patient B should see the join link immediately after the update.

### Cancelled or completed meetings

If a meeting becomes `cancelled` or `completed`:

- the patient app must not render the meeting as joinable,
- active invite lookup should no longer expose a ready invite in the list,
- explicit invite issuance endpoints must reject issuance for terminal states.

### Far-future appointments

If appointments are booked days or weeks ahead, the canonical short link must
still remain valid according to the lifecycle rule chosen above. Otherwise, the
patient experience regresses back to manual refresh behavior.

### Patient enters too early

Making the link available immediately does not mean the app should invent room
state before the patient joins.

The system must continue to:

- set presence only when token exchange or heartbeat occurs,
- transition meeting status only on actual room activity,
- avoid marking a meeting as waiting merely because an invite exists.

## Testing strategy

This change needs regression tests in both backend and client layers.

### Backend tests

Add or update tests for:

- meeting creation eagerly generates `patient_invite_url`,
- patient meeting list shows the invite immediately after creation,
- meeting update with same patient reuses invite,
- meeting update with new patient rotates invite and invalidates old code,
- cancelled and completed meetings no longer expose active invites,
- explicit invite endpoints still work as fallback and do not break existing
  callers.

The most relevant existing suites are:

- `backend/tests/test_patient_app_meetings.py`
- `backend/tests/test_meeting_video_token.py`

Add meeting service and API regression coverage near those suites rather than
creating an isolated one-off test file.

### Frontend tests

Add or update tests for:

- doctor appointment detail shows copyable patient link after create,
- **Copy patient link** copies existing URL when present,
- fallback invite creation still works if response lacks the field.

### Mobile tests

Add or update tests for:

- patient meeting card renders **Join** when `patient_invite_url` exists on the
  initial list payload,
- fallback invite request still works when invite is stale or missing,
- cancelled and completed meetings remain non-joinable.

## Rollout plan

This change is safe to roll out incrementally.

1. Update backend invite lifecycle and meeting response schema.
2. Add backend regression tests.
3. Update doctor web UI to prefer existing invite URLs.
4. Validate patient mobile behavior against the new list payload.
5. Keep explicit invite endpoints as fallback until all clients rely on the
   eager path successfully.

## Risks and mitigations

The main risk is making the short link too short-lived for future appointments.
Mitigate this by tying short-link validity to appointment lifecycle rather than
to a fixed short TTL.

The second risk is leaving old invites active after patient reassignment.
Mitigate this by explicitly invalidating active invite codes during patient
change handling and by adding regression tests for the old code path.

The third risk is accidental status pollution if code starts treating "invite
exists" as "patient is waiting." Mitigate this by preserving the current
presence-triggered status transitions and by adding tests that verify invite
creation alone does not change meeting status.

## Next steps

The next implementation plan should break this work into:

1. Backend contract and lifecycle changes.
2. Doctor dashboard response and copy-link behavior updates.
3. Patient app validation and regression coverage.
