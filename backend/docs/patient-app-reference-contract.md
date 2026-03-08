# Patient app reference contract

This document describes the current backend contract and reference app
responsibilities for the patient mobile flow. Use it as the handoff baseline
for any production mobile app implementation.

The current state is intentional:

- The backend owns business rules, meeting status transitions, invite
  issuance, and room presence.
- The Flutter app in this repository is a reference implementation that proves
  the flow works end to end.
- The production mobile app team can replace the UI layer later without
  reverse-engineering behavior from screens.

## Scope

This document covers the patient mobile flow for:

- registration
- login
- meeting list
- explicit invite issuance
- patient video token exchange
- patient room presence

It does not define push notifications or WebSocket transport yet. The current
contract is HTTP-first with adaptive polling on the client.

## Architecture boundary

The system currently follows this split:

```text
Patient mobile app
  -> reads meeting snapshot
  -> requests invite explicitly when patient is about to join
  -> exchanges invite proof for short-lived video token
  -> sends presence heartbeat / leave markers

Backend
  -> validates patient auth
  -> validates patient ownership of meeting
  -> issues short-lived patient invite + short code
  -> issues short-lived video token
  -> reconciles room presence into meeting status
```

This split is important. The mobile app must not invent meeting state locally.
The backend is the source of truth.

## Current API contract

The patient app currently depends on these endpoints:

1. `POST /patient-app/register`
2. `POST /patient-app/login`
3. `GET /patient-app/me/meetings`
4. `POST /patient-app/me/meetings/{meeting_id}/invite`
5. `POST /meetings/video/patient/token`
6. `POST /meetings/video/patient/presence/heartbeat`
7. `POST /meetings/video/patient/presence/leave`

The key design rule is that `GET /patient-app/me/meetings` is now read-only.
It returns the current snapshot and never creates a new invite as a side
effect.

Invite issuance is explicit through
`POST /patient-app/me/meetings/{meeting_id}/invite`.

The meeting list endpoint also supports an optional
`updated_after=<ISO-8601 timestamp>` query. Clients can use this to fetch only
meetings whose `updated_at` is newer than the last applied snapshot.

## Meeting list payload

The patient meeting list payload now includes the fields below:

- `id`
- `date_time`
- `description`
- `status`
- `note`
- `patient_invite_url`
- `patient_invite_expires_at`
- `doctor`
- `room_presence`
- `created_at`
- `updated_at`

The fields have these meanings:

- `patient_invite_url`: Current short-link snapshot, if an active invite exists.
- `patient_invite_expires_at`: Expiration timestamp for the active invite
  snapshot. The client can use this to avoid retrying known-expired links.
- `updated_at`: Meeting row update timestamp. Future clients can use this for
  cache invalidation or delta sync.
- `room_presence`: Derived presence state for patient and doctor visibility in
  the room.

## Invite lifecycle

The invite lifecycle is now explicit and predictable.

### Read flow

When the app fetches `GET /patient-app/me/meetings`:

- If an active invite code already exists, the backend returns its short URL and
  expiration timestamp.
- If no active invite exists, the backend returns `patient_invite_url=null`.
- The backend does not create or rotate invite state during the list fetch.

When the app already has a recent snapshot, it can call
`GET /patient-app/me/meetings?updated_after=<timestamp>` and merge only the
returned meetings by `id`.

### Join flow

When the patient taps **Join**:

1. The app checks `patient_invite_url`.
2. If the cached invite is missing or expired, the app calls
   `POST /patient-app/me/meetings/{meeting_id}/invite`.
3. The backend verifies that the meeting belongs to the authenticated patient.
4. The backend either:
   - reuses the active short code and returns a fresh signed invite token, or
   - creates a new invite and returns the new short code and signed invite
     token.
5. The app exchanges the invite proof through
   `POST /meetings/video/patient/token`.

This keeps list reads cheap and keeps invite creation attached to an explicit
user action.

## Presence and meeting status

Presence is handled through best-effort HTTP markers:

- `POST /meetings/video/patient/presence/heartbeat`
- `POST /meetings/video/patient/presence/leave`

The backend reconciles active presence into meeting status transitions:

- `scheduled` -> `waiting` when patient joins first
- `waiting` -> `in_progress` when doctor joins
- `in_progress` -> `waiting` when doctor leaves and patient remains
- `waiting` or `in_progress` -> `scheduled` when nobody is active

The production mobile app should treat `status` and `room_presence` as display
state from the server, not as a local state machine to reimplement.

## Reference app responsibilities

The Flutter app in this repository is responsible for:

- rendering the patient flow
- storing the patient session locally
- polling the meeting list adaptively
- requesting an invite explicitly before join when needed
- retrying join once if the invite proof is stale
- sending presence heartbeat and leave markers while in the room

The reference app is not responsible for:

- owning meeting business rules
- inventing invite tokens
- deciding meeting status transitions
- defining the production app architecture for another team

## Production app responsibilities

A production patient app built by another team should preserve these behaviors:

- use the backend as the source of truth for meeting state
- treat invite issuance as an explicit action
- treat invite proofs as short-lived and refreshable
- reuse `updated_at` and `patient_invite_expires_at` for client cache logic
- send presence heartbeat and leave markers while the user is in the room

The production app may change:

- UI framework
- state management
- navigation structure
- polling transport
- push or realtime delivery strategy

It must not silently change API semantics without backend agreement.

## Current sync model

The current reference clients use adaptive polling:

- Fast refresh for active waiting meetings
- Medium refresh near meeting time
- Slow refresh while idle
- No refresh while the app or tab is inactive

This is a reference sync strategy, not the final realtime strategy.

## Future realtime contract

If the platform adds realtime transport later, keep the REST contract above and
add event delivery on top of it. Do not replace the REST contract with
transport-specific state.

Recommended event types:

- `meeting.updated`
- `meeting.cancelled`
- `meeting.invite_ready`
- `meeting.presence_changed`
- `meeting.started`

Recommended event payload minimum:

- `meeting_id`
- `updated_at`
- `status`
- `room_presence`
- `patient_invite_url`
- `patient_invite_expires_at`

With that shape, a production app can support:

- WebSocket while foregrounded
- push notification while backgrounded
- polling as fallback only

## Testing baseline

The backend currently has regression coverage for patient meeting behavior in:

- `backend/tests/test_patient_app_meetings.py`
- `backend/tests/test_meeting_video_token.py`

These tests cover:

- read-only meeting list behavior
- explicit invite issuance
- invite reuse
- patient token exchange
- presence-driven status transitions

Any future contract change must update those tests first.

## Next steps

The next backend-facing improvements that fit this contract are:

1. Add a documented realtime event schema without removing REST.
2. Add mobile-side lint and analyze checks to CI for the reference app.
3. Add tombstone or removal semantics if the mobile app later needs full
   deletion-aware delta sync.
