# Phase-1 Backend Hardening: Access Control and Matrix

## Scope
- Assignment-based patient access only.
- Roles enforced: `admin`, `doctor`, `staff` (staff denied for patient data).
- Invite-only onboarding for clinical specialists.
- Break-glass disabled by policy.

## Doctor-Patient Assignment Integrity
- `doctor_patient_assignments` enforces:
  - `UNIQUE (doctor_id, patient_id)` via `uq_dpa_doctor_patient_pair`.
  - Partial unique primary doctor per patient via `uq_dpa_primary_per_patient` with `WHERE role = 'primary'`.
  - Indexed `doctor_id` and `patient_id`.
  - Foreign keys to `users.id` and `patients.id` with `ON DELETE CASCADE`.
- SQLAlchemy relationships for assignment ownership:
  - `Patient.assigned_doctors`: `cascade="all, delete-orphan"`, `passive_deletes=True`.
  - `User.patient_assignments`: `cascade="all, delete-orphan"`, `passive_deletes=True`.

## Service-Layer Policy Enforcement
- `app/services/patient.py` owns role and assignment checks in `verify_doctor_patient_access(...)`.
- Enforcement rules:
  - Admin: allow.
  - Doctor: allow only when assigned to patient.
  - Others: deny.
- Patient list filtering for doctors is enforced in service via `list_patients_for_user(...)`.

## Invite Lifecycle and Policy
- Direct `POST /users` blocks clinical specialist creation when invite-only policy is enabled.
- `POST /users/invites` rejects non-clinical roles.
- Invite acceptance consumes token (`used_at`) and prevents reuse.

## Break-Glass Policy
- `POST /patients/{patient_id}/break-glass` returns `403` when policy toggle is disabled.
- Assignment access checks do not grant break-glass bypass in phase-1 path.

## Audit Logging Coverage
- Assignment lifecycle:
  - `patient_assignment_create`
  - `patient_assignment_update`
  - `patient_assignment_delete`
- Invite lifecycle:
  - `invite_accept`
- Access control:
  - `patient_access_denied`
  - `http_403_denied` (middleware-level)

## Test Matrix Commands
- SQLite baseline:
  - `./venv/bin/python -m pytest tests -q`
- PostgreSQL matrix:
  - `TEST_DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/patient_db_test RUN_TEST_MIGRATIONS=true ./venv/bin/python -m pytest tests -q`
