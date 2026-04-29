# Backend testing blueprint and coverage matrix

This document defines the testing baseline for the FastAPI backend in this
repository. It is based on the current backend implementation, the existing
test suite under `backend/tests/`, and FastAPI's official testing model with
`pytest` and `TestClient`.

As of March 10, 2026, the backend already has strong coverage in several
high-risk areas, especially authentication, role-based access control, user
management, meeting access, and device-ingest security. The main goal of this
document is to turn that work into a repeatable quality bar and a clear
coverage plan that you can use in implementation reviews, CI planning, and
formal project documentation.

## Why this document exists

You need a single source of truth for how backend testing works in this
project. Without that, tests become a collection of files instead of a quality
system.

This blueprint defines:

- the current test foundation in the repository
- the target testing layers for a production-grade FastAPI service
- the current coverage matrix by router and feature area
- the highest-priority gaps that still need direct tests
- the commands and release gates that should block unsafe changes

## Current test foundation

The backend already follows the core FastAPI testing pattern from the official
documentation: instantiate the application once, use
`fastapi.testclient.TestClient`, and write `pytest` test functions that assert
on HTTP responses and side effects.

The current test harness in `backend/tests/conftest.py` provides these
capabilities:

- `TestClient(app)` for HTTP-level integration tests
- `app.dependency_overrides[get_db]` to isolate test database usage
- an in-memory SQLite test database by default
- optional PostgreSQL test execution through `TEST_DATABASE_URL`
- optional Alembic migration execution through `RUN_TEST_MIGRATIONS=true`
- SQLite per-test schema setup and teardown through `Base.metadata.create_all()`
  and `drop_all()`
- PostgreSQL test cleanup through per-test `TRUNCATE ... RESTART IDENTITY CASCADE`
  after a one-time migration/bootstrap pass
- disabled rate limiting during tests through `app.state.limiter.enabled = False`

This foundation is strong enough for fast local feedback and for broad
HTTP-level coverage. It also supports a stricter PostgreSQL compatibility pass
for features that depend on production database behavior.

## Quality bar for this backend

This backend supports clinical workflows, privileged operations, auditability,
and signed device traffic. That means the quality bar must be stricter than a
basic CRUD application.

Every security-sensitive or data-mutating endpoint must meet all of these
requirements:

1. Cover the happy path.
2. Cover authentication failure and permission denial.
3. Cover input validation failure and business-rule rejection.
4. Assert on database side effects, not only response payloads.
5. Assert on audit side effects where the feature is supposed to write audit
   records.
6. Add a regression test for every production bug or policy defect that gets
   fixed.

For this repository, no backend feature should be considered complete until its
tests prove both functional correctness and policy enforcement.

## Test layers for this repository

This repository should use five testing layers. The layers are already present
in parts of the suite, but this section makes the structure explicit.

| Layer | Purpose | Current examples | Expected gate |
| --- | --- | --- | --- |
| Unit | Validate pure logic, helpers, crypto, request parsing, and settings normalization. | `test_auth.py`, `test_request_utils.py`, `test_settings_config.py`, `test_zego_token.py`, `test_device_error_diagnostics.py` | Must run on every backend change |
| Service and policy | Validate business rules close to the DB layer without requiring full HTTP setup. | direct DB-oriented cases in `test_patients.py`, policy-oriented helper coverage in `test_auth.py` | Must run on every backend change |
| API integration | Validate router contracts, status codes, payloads, cookies, and DB writes. | `test_api.py`, `test_users.py`, `test_patients.py`, `test_meetings_access.py` | Must run on every backend change |
| Security and regression | Validate negative cases, RBAC, 2FA, replay protection, invite tampering, and audit rules. | `test_admin_security_policies.py`, `test_pressure_security.py`, `test_dense_mode_access.py`, `test_role_based_access.py` | Must block merges for affected areas |
| Workflow integration | Validate multi-step flows that span setup, security, persistence, and business outcomes. | `test_device_ingest_flow.py`, `test_patient_app_meetings.py`, `test_meeting_video_token.py` | Must run for release candidates and critical changes |

The project should keep fast tests in the default path and reserve slower,
high-realism checks for a second gate. That keeps local iteration fast without
lowering the release standard.

## Current coverage matrix

The table below summarizes backend coverage based on the current test files in
`backend/tests/`. The status labels are pragmatic, not cosmetic:

- **Strong** means the area has broad positive and negative coverage.
- **Medium** means the area has meaningful tests but still has direct gaps.
- **Weak** means behavior exists in production code but is not directly tested
  enough at the router level.

| Area | Status | Evidence in current suite | Primary gaps |
| --- | --- | --- | --- |
| Auth core (`/auth/login`, `/refresh`, `/logout`, password reset, invite accept, `/auth/me`) | Strong | `test_api.py`, `test_auth.py`, `test_admin_security_policies.py`, `test_auth_2fa_management.py` | keep extending with regression coverage when auth policy changes |
| 2FA and trusted-device management under `/auth/2fa/*` | Strong | `test_admin_security_policies.py` and `test_auth_2fa_management.py` cover status, verify, disable, reset, trusted-device listing/revoke, revoke-all, and admin 2FA status/reset flows | keep adding only when new policy or lockout behavior changes |
| User management under `/users/*` | Strong | `test_users.py`, `test_api.py`, `test_role_based_access.py` cover CRUD, filters, pagination, bulk operations, verification, invite lifecycle, and audit | add more validation-edge cases only if new bugs appear |
| Patient management under `/patients/*` | Strong | `test_patients.py`, `test_role_based_access.py` cover CRUD, unauthorized access, doctor assignment rules, soft delete, and assignment audit | bulk-delete endpoint needs explicit dedicated coverage if it becomes a common admin workflow |
| Meetings core under `/meetings/*` | Strong | `test_meetings_access.py` covers owner versus assigned access, create, update, eager invite generation, admin scope, and stats visibility | delete and some malformed request paths could use additional direct negative tests |
| Meeting video, patient join, and room presence | Strong | `test_meeting_video_token.py`, `test_zego_token.py` cover token issuance, provider behavior, patient invite exchange, tampering rejection, and presence transitions | concurrency or multi-actor race coverage is still limited |
| Patient mobile meeting endpoints under `/patient-app/me/meetings*` | Strong | `test_patient_app_meetings.py` covers listing behavior, invite reuse, expiry handling, delta sync, and room presence | no change needed before adding new behavior |
| Patient mobile registration and login under `/patient-app/register` and `/patient-app/login` | Strong | `test_patient_app_auth.py` covers successful registration, expired-code rejection, phone mismatch protection, successful login, and invalid PIN rejection | add lockout or retry-policy cases if the mobile auth policy becomes stricter |
| Patient registration code issue under `POST /patient-app/{patient_id}/code` | Strong | `test_api.py` and `test_patient_app_auth.py` cover assigned-doctor access, admin success, `medical_student` denial, previous-code invalidation, and not-found behavior | add audit coverage only if the endpoint later becomes an audited support workflow |
| Dense mode patient views under `/patients/{id}/summary`, `/timeline`, `/active-orders`, `/results/trends` | Strong | `test_dense_mode_access.py` covers assignment gates and audit logging | create-path coverage is still missing |
| Dense mode write actions under `/patients/{id}/orders` and `/notes` | Strong | `test_dense_mode_access.py` covers create success, assignment denial, validation failure, timeline side effects, and audit writes | keep extending if note or order types gain more branching rules |
| Break-glass policy under `/patients/{id}/break-glass` | Strong | `test_dense_mode_access.py` covers policy-disabled behavior and non-bypass semantics | if policy changes later, add enabled-mode coverage immediately |
| Alerts acknowledge under `/alerts/{alert_id}/acknowledge` | Strong | `test_dense_mode_access.py` covers assigned doctor, unassigned doctor, admin, and `medical_student` denial | add malformed payload validation only if schema changes |
| Audit APIs under `/audit/*` | Strong | `test_audit_logs.py` covers filters, exports, inferred results, JSON details, and CSV serialization; `test_stats_and_audit_contracts.py` adds deny-path and cursor-contract checks | keep adding only when export format or policy changes |
| Stats overview under `/stats/overview` | Strong | `test_meetings_access.py`, `test_role_based_access.py`, and `test_stats_and_audit_contracts.py` cover role visibility plus payload-contract assertions | add deeper aggregation edge cases only if bugs appear |
| Device ingest under `/device/v1/pressure` and `/add_pressure` | Strong | `test_pressure_security.py`, `test_device_ingest_flow.py`, and `test_device_error_diagnostics.py` cover signature modes, body hash, nonce replay, registered devices, schema validation logging, and admin-to-device flow | add explicit time-skew boundary cases if device fleet issues appear |
| Device monitor APIs under `/device/v1/health`, `/stats`, `/errors` | Strong | `test_device_monitor_api.py` covers public health behavior, admin-only stats/errors access, counts, filters, and serialized diagnostics payloads | extend only when monitor schema changes |
| Security admin toolkit under `/security/*` | Strong | `test_admin_security_policies.py` plus `test_security_admin_endpoints.py` cover device registry, IP ban CRUD, login-attempt filtering, and deny paths | add only when new admin security operations are introduced |
| Cross-cutting request and config helpers | Strong | `test_request_utils.py`, `test_settings_config.py`, `test_auth.py` | keep extending only when config or proxy behavior changes |

## Highest-priority gaps

The current suite is already solid in the most dangerous business areas. The
next work should focus on features that exist in production code but still lack
direct endpoint-level tests.

### P0: immediate gaps

Only a small number of direct endpoint gaps remain after the current testing push.

1. Capture the PostgreSQL-backed compatibility subset in CI and record the result with each backend release.
2. Expand security-header assertions if middleware policy adds CSP or environment-specific directives.

### P1: hardening gaps

These gaps are not urgent, but they improve realism and long-term confidence.

1. Add boundary-time tests for expiry, replay windows, and lockout timers.
2. Add broader negative-path coverage for malformed payload combinations on admin-only endpoints.
3. Add PostgreSQL-specific assertions for JSON, constraints, and ordering-sensitive queries once the compatibility gate is in CI.

### P2: realism upgrades

These upgrades improve confidence when the codebase grows or traffic becomes
more varied.

1. Run a PostgreSQL-backed compatibility subset in CI for the most
   database-sensitive suites.
2. Add targeted async tests only where async behavior cannot be exercised well
   through `TestClient`.
3. Add boundary-time tests around replay windows, invite expiry, and lockout
   timers.

## Recommended implementation order

You can expand coverage without destabilizing the suite if you implement new
tests in a strict order. That order should follow business risk, not file
alphabetical order.

1. Add PostgreSQL-backed compatibility coverage for the most DB-sensitive
   suites in CI.
2. Add boundary-time regression coverage for expiry and replay logic.
3. Add malformed-payload hardening tests for admin-only routes that currently
   rely mostly on schema defaults.

This order keeps the next wave of tests centered on production operations,
support workflows, and access control.

## Test case design standard

Every new backend test case should document the behavior it proves. For this
project, each critical endpoint test should explicitly define these parts:

- actor and role
- preconditions and created fixtures
- request path, method, payload, and headers
- expected status code
- expected response body or headers
- expected database side effect
- expected audit side effect
- expected security consequence, if applicable

For example, a good device-monitor authorization test does not stop at
`assert response.status_code == 403`. It also proves that the same endpoint
returns the expected payload for an admin and that filtering parameters behave
correctly under valid access.

## Commands and execution profiles

You need at least two execution profiles: a fast local gate and a stricter
compatibility gate.

### Fast local gate

Use this path during normal development:

```bash
cd backend
python -m pytest -q
```

You can also use the repository helper:

```bash
./scripts/test-backend.sh
```

### Focused debugging

Use targeted test runs while implementing a feature or fixing a bug:

```bash
cd backend
python -m pytest tests/test_users.py -q
python -m pytest tests/test_pressure_security.py -q -k nonce
```

### PostgreSQL compatibility gate

Use this path for features that depend on production-like database behavior:

```bash
cd backend
TEST_DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/patient_db_test \
RUN_TEST_MIGRATIONS=true \
python -m pytest tests -q
```

The PostgreSQL path is especially important for constraints, JSON behavior,
indexes, and migration-sensitive workflows.

For a faster DB-sensitive gate from the repository root, use:

```bash
TEST_DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/patient_db_test \
./scripts/test-backend-postgres-subset.sh
```

Current PostgreSQL subset:

- `tests/test_users.py`
- `tests/test_patients.py`
- `tests/test_dense_mode_access.py`
- `tests/test_audit_logs.py`
- `tests/test_auth_2fa_management.py`
- `tests/test_security_admin_endpoints.py`
- `tests/test_stats_and_audit_contracts.py`

## Verified results

The testing strategy in this document is not only theoretical. It has been
verified locally on March 10, 2026 with both the fast SQLite gate and the
PostgreSQL compatibility subset.

- SQLite full backend suite: `238 passed`
- PostgreSQL compatibility subset: `106 passed`

These results matter because they prove two different qualities:

- fast local feedback still works after the expanded coverage and harness changes
- DB-sensitive features also work under real PostgreSQL execution, including
  audit export, 2FA management, dense mode writes, and admin security flows

## Definition of done for backend features

This section defines the minimum bar for calling a backend change complete.

A backend feature is not done until:

- the affected endpoint or service has happy-path coverage
- the permission model has direct allow and deny coverage
- validation failures are covered
- database side effects are asserted
- audit side effects are asserted when applicable
- a regression test exists for the bug or policy defect being fixed
- the relevant suite passes in the fast local gate
- database-sensitive changes also pass the PostgreSQL compatibility gate

## External references

These references define the testing model that this repository already follows:

- [FastAPI testing tutorial](https://fastapi.tiangolo.com/tutorial/testing/)
- [FastAPI dependency overrides for tests](https://fastapi.tiangolo.com/advanced/testing-dependencies/)
- [FastAPI async tests](https://fastapi.tiangolo.com/advanced/async-tests/)
- [pytest fixtures guide](https://docs.pytest.org/en/stable/how-to/fixtures.html)
- [pytest parametrization examples](https://docs.pytest.org/en/stable/example/parametrize.html)

## Next steps

The next documentation or implementation pass should do these three things:

1. Convert the P0 gap list into individual test tickets.
2. Add direct route tests for patient-app registration, login, and code issue.
3. Add direct route tests for device-monitor and remaining security admin
   endpoints.
