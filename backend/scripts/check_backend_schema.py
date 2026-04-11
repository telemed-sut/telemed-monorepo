from pathlib import Path
import os
import sys

from sqlalchemy import create_engine, inspect

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.db.alembic_compat import ensure_single_alembic_head, normalize_database_url

REQUIRED_TABLES = {
    "user_sessions",
    "patient_app_sessions",
    "user_privileged_role_assignments",
}
REQUIRED_COLUMNS = {
    "patients": {
        "failed_app_login_attempts",
        "app_account_locked_until",
        "last_app_failed_login_at",
    },
    "device_registrations": {"device_secret"},
    "users": {"two_factor_secret"},
}
REQUIRED_INDEXES = {
    "user_sessions": {
        "ix_user_sessions_user_id",
        "ix_user_sessions_session_id",
        "ix_user_sessions_expires_at",
        "ix_user_sessions_revoked_at",
    },
    "patient_app_sessions": {
        "ix_patient_app_sessions_patient_id",
        "ix_patient_app_sessions_session_id",
        "ix_patient_app_sessions_expires_at",
        "ix_patient_app_sessions_revoked_at",
    },
    "user_privileged_role_assignments": {
        "ix_user_privileged_role_assignments_created_by",
        "ix_user_privileged_role_assignments_revoked_by",
    },
}


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    ensure_single_alembic_head()

    engine = create_engine(normalize_database_url(database_url), pool_pre_ping=True)
    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())

        missing_tables = sorted(REQUIRED_TABLES - table_names)
        if missing_tables:
            raise RuntimeError("Missing required tables after migrations: " + ", ".join(missing_tables))

        missing_columns: list[str] = []
        for table_name, expected_columns in REQUIRED_COLUMNS.items():
            if table_name not in table_names:
                continue
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            missing_columns.extend(
                f"{table_name}.{column_name}"
                for column_name in sorted(expected_columns - columns)
            )
        if missing_columns:
            raise RuntimeError("Missing required columns after migrations: " + ", ".join(missing_columns))

        missing_indexes: list[str] = []
        for table_name, expected_indexes in REQUIRED_INDEXES.items():
            if table_name not in table_names:
                continue
            indexes = {index["name"] for index in inspector.get_indexes(table_name)}
            missing_indexes.extend(
                f"{table_name}.{index_name}"
                for index_name in sorted(expected_indexes - indexes)
            )
        if missing_indexes:
            raise RuntimeError("Missing required indexes after migrations: " + ", ".join(missing_indexes))

    print("Backend schema smoke check passed.")


if __name__ == "__main__":
    main()
