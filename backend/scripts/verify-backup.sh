#!/usr/bin/env bash
# ============================================================
# Database Backup Verification Script
# ============================================================
# Purpose:  Verify that a PostgreSQL backup is restorable
#           and contains consistent, complete data.
# Usage:    ./verify-backup.sh [--backup-file path/to/dump.sql]
#           ./verify-backup.sh --dry-run    (test logic only)
# ============================================================
set -euo pipefail

# -----------------------------------------------------------
# Configuration
# -----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Database connection — read from .env.test or environment
source_env_if_exists() {
    local env_file="${1:-}"
    if [[ -n "$env_file" && -f "$env_file" ]]; then
        # shellcheck disable=SC2046
        export $(grep -v '^#' "$env_file" | grep -v '^$' | xargs)
    fi
}

# Load .env.test if available (test DB credentials)
source_env_if_exists "$PROJECT_ROOT/.env.test"
# Override with .env.local if it exists (local dev credentials)
source_env_if_exists "$PROJECT_ROOT/.env.local"

DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" ]]; then
    echo "❌ DATABASE_URL is not set."
    echo "   Set it via environment or create .env.test / .env.local"
    echo "   Example: postgresql+psycopg://user:pass@localhost:5432/dbname"
    exit 1
fi

# Extract connection details from DATABASE_URL
# Format: postgresql://user:password@host:port/dbname?options
DB_HOST=$(echo "$DB_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
DB_PORT=$(echo "$DB_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_PORT="${DB_PORT:-5432}"
DB_USER=$(echo "$DB_URL" | sed -n 's|.*//\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DB_URL" | sed -n 's|.*//[^:]*:\([^@]*\)@.*|\1|p')
DB_NAME=$(echo "$DB_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

# Temp database for restore verification
VERIFY_DB="backup_verify_$(date +%Y%m%d_%H%M%S)_$$"

# Backup file — create one if not provided
BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
    BACKUP_FILE="/tmp/telemed_backup_$(date +%Y%m%d_%H%M%S).sql"
    echo "📦 No backup file provided. Creating one now..."
    echo "   → $BACKUP_FILE"
    pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --no-owner --no-privileges \
        -F p \
        -f "$BACKUP_FILE"
    echo "   ✅ Backup created ($(du -h "$BACKUP_FILE" | cut -f1))"
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "❌ Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Counters
ERRORS=0
WARNINGS=0
TESTS_RUN=0
TESTS_PASSED=0

# -----------------------------------------------------------
# Helper functions
# -----------------------------------------------------------
pass() {
    TESTS_RUN=$((TESTS_RUN + 1))
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  ✅ $1"
}

fail() {
    TESTS_RUN=$((TESTS_RUN + 1))
    ERRORS=$((ERRORS + 1))
    echo "  ❌ $1"
}

warn() {
    WARNINGS=$((WARNINGS + 1))
    echo "  ⚠️  $1"
}

run_query() {
    PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$1" \
        -t -A \
        -c "$2" 2>/dev/null
}

cleanup() {
    echo ""
    echo "🧹 Cleaning up temporary database: $VERIFY_DB"
    PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = '$VERIFY_DB'
              AND pid <> pg_backend_pid();" 2>/dev/null || true

    PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\";" 2>/dev/null || true

    # Optionally remove backup file (uncomment if you want auto-cleanup)
    # rm -f "$BACKUP_FILE"

    echo ""
    if [[ $ERRORS -eq 0 ]]; then
        echo "🎉 Backup verification PASSED"
    else
        echo "💥 Backup verification FAILED ($ERRORS errors, $WARNINGS warnings)"
    fi
    echo "   Tests: $TESTS_PASSED/$TESTS_RUN passed"
    exit $ERRORS
}

trap cleanup EXIT

# -----------------------------------------------------------
# Main verification
# -----------------------------------------------------------
echo ""
echo "============================================================"
echo "  Database Backup Verification"
echo "============================================================"
echo "  Source DB:      $DB_NAME ($DB_HOST:$DB_PORT)"
echo "  Backup file:    $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
echo "  Verify DB:      $VERIFY_DB"
echo "  Date:           $(date)"
echo "============================================================"
echo ""

# Step 1: Create temporary database
echo "📋 Step 1: Creating temporary database..."
PGPASSWORD="$DB_PASS" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -c "CREATE DATABASE \"$VERIFY_DB\";" 2>/dev/null || {
        echo "❌ Failed to create temporary database"
        exit 1
    }
echo "   ✅ Temporary database created"
echo ""

# Step 2: Restore backup
echo "📋 Step 2: Restoring backup to temporary database..."
RESTORE_OUTPUT=$(PGPASSWORD="$DB_PASS" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$VERIFY_DB" \
    -f "$BACKUP_FILE" 2>&1) || {
        echo "❌ Restore failed!"
        echo "$RESTORE_OUTPUT" | tail -20
        exit 1
    }
echo "   ✅ Backup restored successfully"
echo ""

# Step 3: Schema verification
echo "📋 Step 3: Verifying schema..."

# Check table count
ORIG_TABLES=$(run_query "$DB_NAME" "
    SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
")
RESTORED_TABLES=$(run_query "$VERIFY_DB" "
    SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
")

if [[ "$ORIG_TABLES" == "$RESTORED_TABLES" ]]; then
    pass "Table count matches ($ORIG_TABLES tables)"
else
    fail "Table count mismatch: source=$ORIG_TABLES, restored=$RESTORED_TABLES"
fi

# Check key tables exist
for table in users patients meetings encounters medications labs alerts audit_logs login_attempts ip_bans heart_sound_records pressure_records device_registrations user_invites doctor_patient_assignments; do
    EXISTS=$(run_query "$VERIFY_DB" "
        SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '$table';
    ")
    if [[ "$EXISTS" == "1" ]]; then
        pass "Table '$table' exists"
    else
        fail "Table '$table' is missing"
    fi
done
echo ""

# Step 4: Data integrity checks
echo "📋 Step 4: Verifying data integrity..."

# Row count comparison for key tables
for table in users patients meetings audit_logs; do
    ORIG_COUNT=$(run_query "$DB_NAME" "SELECT count(*) FROM $table;" 2>/dev/null || echo "0")
    RESTORED_COUNT=$(run_query "$VERIFY_DB" "SELECT count(*) FROM $table;" 2>/dev/null || echo "0")

    if [[ "$ORIG_COUNT" == "$RESTORED_COUNT" ]]; then
        pass "$table: $ORIG_COUNT rows match"
    else
        fail "$table: source=$ORIG_COUNT, restored=$RESTORED_COUNT"
    fi
done
echo ""

# Step 5: Constraint verification
echo "📋 Step 5: Verifying constraints..."

# Check foreign key count
ORIG_FKS=$(run_query "$DB_NAME" "
    SELECT count(*) FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public';
")
RESTORED_FKS=$(run_query "$VERIFY_DB" "
    SELECT count(*) FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public';
")

if [[ "$ORIG_FKS" == "$RESTORED_FKS" ]]; then
    pass "Foreign key count matches ($ORIG_FKS)"
else
    fail "FK count mismatch: source=$ORIG_FKS, restored=$RESTORED_FKS"
fi

# Check unique constraint count
ORIG_UQ=$(run_query "$DB_NAME" "
    SELECT count(*) FROM information_schema.table_constraints
    WHERE constraint_type = 'UNIQUE' AND table_schema = 'public';
")
RESTORED_UQ=$(run_query "$VERIFY_DB" "
    SELECT count(*) FROM information_schema.table_constraints
    WHERE constraint_type = 'UNIQUE' AND table_schema = 'public';
")

if [[ "$ORIG_UQ" == "$RESTORED_UQ" ]]; then
    pass "Unique constraint count matches ($ORIG_UQ)"
else
    fail "Unique constraint mismatch: source=$ORIG_UQ, restored=$RESTORED_UQ"
fi

# Check index count
ORIG_IDX=$(run_query "$DB_NAME" "
    SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public';
")
RESTORED_IDX=$(run_query "$VERIFY_DB" "
    SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public';
")

if [[ "$ORIG_IDX" == "$RESTORED_IDX" ]]; then
    pass "Index count matches ($ORIG_IDX)"
else
    warn "Index count differs: source=$ORIG_IDX, restored=$RESTORED_IDX (may be expected for non-unique indexes)"
fi
echo ""

# Step 6: Sequence verification
echo "📋 Step 6: Verifying sequences..."

SEQUENCE_ISSUES=0
while IFS= read -r seq_name; do
    if [[ -z "$seq_name" ]]; then continue; fi

    # Get last value from source
    SRC_VAL=$(run_query "$DB_NAME" "SELECT last_value FROM $seq_name;" 2>/dev/null || echo "0")
    # Get last value from restored
    RST_VAL=$(run_query "$VERIFY_DB" "SELECT last_value FROM $seq_name;" 2>/dev/null || echo "0")

    if [[ "$SRC_VAL" != "$RST_VAL" ]]; then
        SEQUENCE_ISSUES=$((SEQUENCE_ISSUES + 1))
        warn "Sequence $seq_name: source=$SRC_VAL, restored=$RST_VAL"
    fi
done <<< "$(run_query "$DB_NAME" "
    SELECT sequence_schema || '.' || sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public';
")

if [[ $SEQUENCE_ISSUES -eq 0 ]]; then
    pass "All sequences match"
else
    warn "$SEQUENCE_ISSUES sequences differ (may be acceptable for test data)"
fi
echo ""

# Step 7: CASCADE FK test
echo "📋 Step 7: Testing CASCADE delete behavior..."

# Insert a test patient, then verify CASCADE works
CASCADE_RESULT=$(run_query "$VERIFY_DB" "
    BEGIN;
    -- Create a test patient
    INSERT INTO patients (first_name, last_name, date_of_birth)
    VALUES ('TestCascade', 'Verify', '1990-01-01')
    RETURNING id;
" 2>&1)

if echo "$CASCADE_RESULT" | grep -q "^[a-f0-9-]*$"; then
    TEST_PATIENT_ID="$CASCADE_RESULT"
    CASCADE_OK=true

    # Check that heart_sound_records CASCADE is configured
    CASCADE_CONFIG=$(run_query "$VERIFY_DB" "
        SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'heart_sound_records'::regclass
          AND contype = 'f'
          AND confrelid = 'patients'::regclass;
    ")

    if [[ "$CASCADE_CONFIG" == "c" ]]; then
        pass "heart_sound_records has ON DELETE CASCADE"
    else
        warn "heart_sound_records CASCADE config: '$CASCADE_CONFIG' (expected 'c')"
    fi

    # Cleanup
    run_query "$VERIFY_DB" "
        DELETE FROM patients WHERE id = '$TEST_PATIENT_ID';
        COMMIT;
    " 2>/dev/null
else
    warn "Could not test CASCADE (patients table may have required columns)"
fi
echo ""

# Step 8: JSONB data verification (audit_logs)
echo "📋 Step 8: Verifying JSONB data integrity..."

JSONB_COUNT=$(run_query "$VERIFY_DB" "
    SELECT count(*) FROM audit_logs
    WHERE jsonb_typeof(details) = 'object';
" 2>/dev/null || echo "0")

if [[ "$JSONB_COUNT" -gt 0 ]]; then
    pass "$JSONB_COUNT audit log entries have valid JSONB details"
else
    # Check if audit_logs has any rows at all
    TOTAL_AUDIT=$(run_query "$VERIFY_DB" "SELECT count(*) FROM audit_logs;" 2>/dev/null || echo "0")
    if [[ "$TOTAL_AUDIT" == "0" ]]; then
        pass "audit_logs is empty (expected for fresh database)"
    else
        warn "audit_logs has $TOTAL_AUDIT rows but none with valid JSONB details"
    fi
fi
echo ""

# Step 9: User data integrity
echo "📋 Step 9: Verifying user data integrity..."

# Check for users with NULL required fields
NULL_EMAILS=$(run_query "$VERIFY_DB" "
    SELECT count(*) FROM users WHERE email IS NULL OR email = '';
" 2>/dev/null || echo "0")

if [[ "$NULL_EMAILS" == "0" ]]; then
    pass "No users with empty email"
else
    fail "$NULL_EMAILS users have empty email"
fi

# Check for duplicate emails
DUP_EMAILS=$(run_query "$VERIFY_DB" "
    SELECT count(*) FROM (
        SELECT email FROM users WHERE deleted_at IS NULL
        GROUP BY email HAVING count(*) > 1
    ) dup;
" 2>/dev/null || echo "0")

if [[ "$DUP_EMAILS" == "0" ]]; then
    pass "No duplicate active user emails"
else
    fail "$DUP_EMAILS duplicate active user emails found"
fi

# Check password hashes are present
NO_PASSWORD=$(run_query "$VERIFY_DB" "
    SELECT count(*) FROM users WHERE password_hash IS NULL OR password_hash = '';
" 2>/dev/null || echo "0")

if [[ "$NO_PASSWORD" == "0" ]]; then
    pass "All users have password hashes"
else
    fail "$NO_PASSWORD users have no password hash"
fi
echo ""

# Step 10: Backup file validation
echo "📋 Step 10: Verifying backup file..."

# Check backup file size
BACKUP_SIZE=$(du -k "$BACKUP_FILE" | cut -f1)
if [[ "$BACKUP_SIZE" -gt 0 ]]; then
    pass "Backup file size: ${BACKUP_SIZE}KB"
else
    fail "Backup file is empty"
fi

# Check backup contains CREATE statements
HAS_CREATE=$(grep -c "CREATE TABLE" "$BACKUP_FILE" 2>/dev/null || echo "0")
if [[ "$HAS_CREATE" -gt 0 ]]; then
    pass "Backup contains $HAS_CREATE CREATE TABLE statements"
else
    fail "Backup file does not contain CREATE TABLE statements"
fi

# Check backup contains COPY statements (data)
HAS_COPY=$(grep -c "^COPY " "$BACKUP_FILE" 2>/dev/null || echo "0")
if [[ "$HAS_COPY" -gt 0 ]]; then
    pass "Backup contains $HAS_COPY COPY (data) statements"
else
    warn "Backup file has no COPY statements (schema-only backup)"
fi
echo ""

# Summary will be printed by the cleanup trap
# The exit code determines pass/fail
