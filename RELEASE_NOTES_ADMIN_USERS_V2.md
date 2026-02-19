# Release Notes — Admin User Management v2

**Migrations:** `20260215_0006` (schema) + `20260215_0007` (seed)
**Branch:** `feature`

---

## What Changed

### Backend

| Area | Change |
|------|--------|
| **User model** | Added `is_active` (bool, default true) and `deleted_at` (timestamp, nullable) columns |
| **Schemas** | Removed `is_superuser` (never existed in DB). Added license validation, expiry validation |
| **GET /users** | Now **admin-only** (was admin+staff). Added filters: `verification_status`, `include_deleted` |
| **DELETE /users/:id** | Changed from hard delete to **soft delete** (`deleted_at` + `is_active=false`) |
| **POST /users/:id/verify** | New endpoint — admin sets a user's verification to "verified" |
| **Audit logging** | All user CRUD now logged: `user_create`, `user_update`, `user_delete`, `user_verify`, `user_invite` with before/after snapshots |
| **Auth: login** | Soft-deleted and inactive users are now blocked from login |
| **Auth: get_current_user** | Excludes soft-deleted users; returns 403 for inactive accounts; fixed UUID casting for SQLite test compatibility |
| **Self-delete protection** | Admin cannot delete themselves |
| **Last-admin protection** | Cannot delete the last remaining admin |
| **Clinical role validation** | Creating a user with a clinical role (doctor, nurse, pharmacist, etc.) now requires `license_no` |

### Frontend

| Area | Change |
|------|--------|
| **Sidebar** | "Users" link visible only to `role=admin` |
| **/users page** | Non-admin users redirected to `/overview` |
| **User type** | Removed `is_superuser`, added `deleted_at`, `updated_at`, `specialty`, `department` |
| **Users table columns** | Added: Verification Status, License Expiry (with Expired/Expiring Soon badges) |
| **Users table filters** | Added: Verification Status filter (unverified/pending/verified) |
| **Create/Edit form** | Added Professional Information section (specialty, department, license_no, license_expiry) for clinical roles |
| **Verify action** | Dropdown menu "Verify" button for unverified clinical users |
| **Delete UX** | Confirmation dialog now says "soft deleted" |
| **Testing** | Added Vitest + Testing Library. 57 frontend tests (role visibility, form validation, verify logic) |

### Seed Data (migration 0007)

| Email | Role | Password |
|-------|------|----------|
| `admin@emedhelp.example.com` | admin | `AdminSeed@2026` |
| `doctor@emedhelp.example.com` | doctor | `DoctorSeed@2026` |

> **Change these passwords immediately in production.**

---

## Pre-deploy Checklist

- [ ] Backend env has `DATABASE_URL`, `JWT_SECRET` configured
- [ ] Run `alembic upgrade head` on staging database
- [ ] Verify existing admin user can still login
- [ ] Verify non-admin users can NOT access `/users`
- [ ] Verify soft-delete works (user disappears from list, cannot login)
- [ ] Verify audit logs are recorded (check `audit_logs` table)
- [ ] Verify clinical role creation requires license number
- [ ] Verify seed users can login (`admin@emedhelp.example.com` / `AdminSeed@2026`)
- [ ] Change seed user passwords in production

---

## Rollback Plan — Migrations 0006 & 0007

### Overview

| Migration | What it does | Downgrade action |
|-----------|-------------|-----------------|
| `20260215_0007` | Seeds `admin@emedhelp.example.com` and `doctor@emedhelp.example.com` | Deletes those two rows from `users` |
| `20260215_0006` | Adds `is_active` (bool) and `deleted_at` (timestamp) columns + index | Drops index, drops both columns |

### Step-by-step Rollback

**Always roll back in reverse order: 0007 first, then 0006.**

```bash
# 1. Roll back seed data (0007 → 0006)
cd backend
alembic downgrade 20260215_0006

# 2. Roll back schema changes (0006 → 0005)
alembic downgrade 20260215_0005

# 3. Verify current revision
alembic current
# Should show: 20260215_0005
```

To roll back only the seed data while keeping the schema:

```bash
alembic downgrade 20260215_0006
```

### Impact Assessment

| What breaks on rollback | Severity | Mitigation |
|------------------------|----------|------------|
| `is_active` column removed — backend code references it in queries, model, schemas | **High** | Must also revert backend code to pre-v2 branch or the app will crash on startup |
| `deleted_at` column removed — soft-delete logic breaks, auth filters fail | **High** | Same as above: revert code |
| Seed users deleted — `admin@emedhelp.example.com` and `doctor@emedhelp.example.com` removed | **Low** | Only affects environments relying on seed credentials; existing users unaffected |
| Soft-deleted users reappear — rolling back `deleted_at` loses the "deleted" marker | **Medium** | Users that were soft-deleted will lose their `deleted_at` and `is_active` values; manual cleanup may be needed |
| Audit log references — existing `audit_logs` entries referencing deleted user fields remain | **Low** | Audit rows are historical; no schema change needed for them |

### Required Code Rollback

Rolling back the migrations alone is **not sufficient**. The following code changes must also be reverted:

| File | What to revert |
|------|---------------|
| `backend/app/models/user.py` | Remove `is_active` and `deleted_at` column definitions |
| `backend/app/schemas/user.py` | Remove `deleted_at` from `UserOut`, remove `is_active` field, restore `is_superuser` if needed |
| `backend/app/api/users.py` | Revert soft-delete to hard-delete, remove `include_deleted` filter, remove verify endpoint |
| `backend/app/services/auth.py` | Remove `deleted_at` and `is_active` checks from `authenticate_user` and `get_current_user` |
| `backend/tests/test_users.py` | Remove entire file (all 36 tests depend on `is_active`, `deleted_at`, verify, soft-delete) |
| `frontend/lib/api.ts` | Remove `is_active`, `deleted_at`, `updated_at` from User/UserCreate/UserUpdate types, remove `verifyUser` function |
| `frontend/components/dashboard/users-table.tsx` | Remove verification columns, license expiry column, professional info form fields, `is_active` references |
| `frontend/components/dashboard/users-content.tsx` | Remove `u.is_active` filter in stats cards |
| `frontend/components/dashboard/sidebar.tsx` | Revert to showing Users link for admin+staff (merge `adminOnlyRoutes` back into `dashboardRoutes`) |
| `frontend/app/users/page.tsx` | Remove admin role gate and redirect to `/overview` |
| `frontend/tests/user-types.test.ts` | Remove or update tests referencing `is_active` and `deleted_at` fields |
| `frontend/tests/user-form-validation.test.ts` | Remove or update tests referencing `is_active` in mock data |

### Rollback Verification Checklist

- [ ] `alembic current` shows `20260215_0005`
- [ ] `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'` does NOT contain `is_active` or `deleted_at`
- [ ] Seed users `admin@emedhelp.example.com` / `doctor@emedhelp.example.com` no longer exist
- [ ] Application starts without errors
- [ ] Existing users can still login
- [ ] `/users` endpoint works with reverted code

---

## Test Summary

| Suite | Tests | Status |
|-------|-------|--------|
| Backend: RBAC | 8 | Pass |
| Backend: CRUD | 5 | Pass |
| Backend: Soft Delete | 5 | Pass |
| Backend: Validation | 2 | Pass |
| Backend: Verify | 2 | Pass |
| Backend: Audit Log | 4 | Pass |
| Backend: Auth (existing) | 10 | Pass |
| Frontend: Role Visibility | 25 | Pass |
| Frontend: Form Validation | 25 | Pass |
| Frontend: Type Structure | 7 | Pass |
| **Total** | **93** | **All pass** |

---

## Release Checklist — Security/RBAC Hardening (Current Batch)

- [ ] CI gate ผ่านครบ: backend tests, frontend typecheck, frontend lint (critical modules), frontend tests, alembic head check
- [ ] ตรวจ `alembic heads` เหลือ head เดียว
- [ ] ตรวจ RBAC endpoints สำคัญ: `/users`, `/users/invites*`, `/audit/logs`, `/security/stats`, `/meetings`, `/stats/overview`
- [ ] ตรวจ Audit Logs filter หน้าใช้งานจริง: action/user/date/result + export CSV
- [ ] ตรวจ Invite lifecycle: create/resend/revoke/expired filter
- [ ] ตรวจ Purge safety: reason + confirm text (`PURGE`) + export snapshot ก่อน purge
- [ ] ตรวจ Emergency toolkit: unlock / reset 2FA / reset password และมี audit log
- [ ] ตรวจ 2FA UX: setup QR, backup codes, trusted devices
- [ ] ตรวจ Meetings segregation: admin, doctor-owner, doctor-assigned, staff
- [ ] ตรวจข้อความ error/toast ว่าไม่แสดง raw JSON/pydantic trace

## Rollback Note — Security/RBAC Hardening (Current Batch)

ถ้าต้อง rollback เร่งด่วน ให้ย้อนเป็นลำดับ:

1. Revert frontend ชุดนี้ก่อน (`/frontend/lib/api.ts`, `/frontend/components/dashboard/*`, `/frontend/components/ui/toast.ts`, `/frontend/app/login/page.tsx`) เพื่อหยุด UX flow ใหม่
2. Revert backend API/security ชุดนี้ (`/backend/app/api/audit.py`, `/backend/app/api/security.py`, `/backend/app/middleware/__init__.py`, `/backend/app/schemas/audit.py`)
3. Revert CI gate update (`/.github/workflows/backend-tests.yml`) หาก pipeline ใหม่ block deploy
4. ตรวจสอบหลัง rollback:
   - login/admin flow ใช้งานได้
   - `/meetings` และ `/users` ไม่เกิด 5xx
   - audit export และ security stats ตอบสนองได้
