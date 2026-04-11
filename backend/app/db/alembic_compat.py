from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from sqlalchemy import create_engine, inspect, text


LEGACY_REVISION_20260409_0029 = "20260409_0029"
INDEX_BRANCH_HEAD_20260408 = "28eb7c50e1f3"
_INDEX_MARKERS = {
    "ix_encounters_status",
    "ix_alerts_patient_id_is_acknowledged",
    "ix_login_attempts_email_created_at",
    "ix_user_privileged_role_assignments_created_by",
    "ix_user_privileged_role_assignments_revoked_by",
}
_SESSION_TABLES = {"user_sessions", "patient_app_sessions"}
_PATIENT_AUTH_COLUMNS = {
    "failed_app_login_attempts",
    "app_account_locked_until",
    "last_app_failed_login_at",
}


@dataclass(frozen=True)
class AlembicCompatibilityResult:
    normalized: bool
    message: str


@dataclass(frozen=True)
class AlembicStateSnapshot:
    database_revisions: tuple[str, ...]
    repo_heads: tuple[str, ...]


def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        return f"postgresql+psycopg://{database_url[len('postgres://'):]}"
    if database_url.startswith("postgresql://"):
        return f"postgresql+psycopg://{database_url[len('postgresql://'):]}"
    return database_url


def collect_alembic_state(
    database_url: str,
    *,
    alembic_ini_path: str | None = None,
) -> AlembicStateSnapshot:
    engine = create_engine(normalize_database_url(database_url), pool_pre_ping=True)

    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        database_revisions: tuple[str, ...]
        if "alembic_version" not in table_names:
            database_revisions = ()
        else:
            database_revisions = tuple(
                row[0]
                for row in connection.execute(
                    text("SELECT version_num FROM alembic_version ORDER BY version_num")
                )
            )

    repo_heads = tuple(_load_script_directory(alembic_ini_path).get_heads())
    return AlembicStateSnapshot(
        database_revisions=database_revisions,
        repo_heads=repo_heads,
    )


def format_alembic_preflight(
    database_url: str,
    *,
    alembic_ini_path: str | None = None,
) -> str:
    snapshot = collect_alembic_state(database_url, alembic_ini_path=alembic_ini_path)
    database_revision_label = ", ".join(snapshot.database_revisions) or "<none>"
    repo_head_label = ", ".join(snapshot.repo_heads) or "<none>"
    return (
        "Alembic preflight: "
        f"database revisions=[{database_revision_label}] "
        f"repo heads=[{repo_head_label}]"
    )


def ensure_single_alembic_head(
    *,
    alembic_ini_path: str | None = None,
) -> str:
    repo_heads = tuple(_load_script_directory(alembic_ini_path).get_heads())
    if len(repo_heads) != 1:
        raise RuntimeError(
            "Expected exactly 1 Alembic head revision, found "
            f"{len(repo_heads)}: {', '.join(repo_heads) or '<none>'}."
        )
    return repo_heads[0]


def normalize_legacy_alembic_revision(database_url: str) -> AlembicCompatibilityResult:
    engine = create_engine(normalize_database_url(database_url), pool_pre_ping=True)

    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        if "alembic_version" not in table_names:
            return AlembicCompatibilityResult(False, "alembic_version table not found; skipping compatibility check.")

        versions = [row[0] for row in connection.execute(text("SELECT version_num FROM alembic_version"))]
        if versions != [LEGACY_REVISION_20260409_0029]:
            return AlembicCompatibilityResult(False, "No legacy Alembic revision remap needed.")

        compatibility_issues = _detect_legacy_revision_mismatch(inspector, table_names)
        if compatibility_issues:
            raise RuntimeError(
                "Refusing to remap legacy Alembic revision "
                f"{LEGACY_REVISION_20260409_0029}: " + "; ".join(compatibility_issues)
            )

        connection.execute(
            text("UPDATE alembic_version SET version_num = :new_revision WHERE version_num = :old_revision"),
            {
                "new_revision": INDEX_BRANCH_HEAD_20260408,
                "old_revision": LEGACY_REVISION_20260409_0029,
            },
        )
        return AlembicCompatibilityResult(
            True,
            "Remapped legacy Alembic revision "
            f"{LEGACY_REVISION_20260409_0029} to {INDEX_BRANCH_HEAD_20260408}.",
        )


def _detect_legacy_revision_mismatch(inspector, table_names: set[str]) -> list[str]:
    issues: list[str] = []

    existing_index_markers = _collect_existing_index_markers(inspector, table_names)
    missing_index_markers = sorted(_INDEX_MARKERS - existing_index_markers)
    if missing_index_markers:
        issues.append("missing expected indexes: " + ", ".join(missing_index_markers))

    existing_session_tables = sorted(_SESSION_TABLES & table_names)
    if existing_session_tables:
        issues.append("unexpected session tables already exist: " + ", ".join(existing_session_tables))

    patient_columns = set()
    if "patients" in table_names:
        patient_columns = {
            column["name"]
            for column in inspector.get_columns("patients")
            if column["name"] in _PATIENT_AUTH_COLUMNS
        }
    if patient_columns:
        issues.append(
            "unexpected patient auth-hardening columns already exist: " + ", ".join(sorted(patient_columns))
        )

    expected_column_types = {
        ("device_registrations", "device_secret"): {"VARCHAR", "TEXT", "STRING"},
        ("users", "two_factor_secret"): {"VARCHAR", "TEXT", "STRING"},
    }
    for (table_name, column_name), allowed_type_names in expected_column_types.items():
        if table_name not in table_names:
            issues.append(f"required table is missing: {table_name}")
            continue

        columns = {column["name"]: column for column in inspector.get_columns(table_name)}
        column = columns.get(column_name)
        if column is None:
            issues.append(f"required column is missing: {table_name}.{column_name}")
            continue

        type_name = type(column["type"]).__name__.upper()
        if type_name not in allowed_type_names:
            issues.append(
                f"unexpected column type for {table_name}.{column_name}: {type_name}"
            )

    return issues


def _collect_existing_index_markers(inspector, table_names: set[str]) -> set[str]:
    table_to_indexes = {
        "encounters": {"ix_encounters_status"},
        "alerts": {"ix_alerts_patient_id_is_acknowledged"},
        "login_attempts": {"ix_login_attempts_email_created_at"},
        "user_privileged_role_assignments": {
            "ix_user_privileged_role_assignments_created_by",
            "ix_user_privileged_role_assignments_revoked_by",
        },
    }

    existing_indexes: set[str] = set()
    for table_name, expected_indexes in table_to_indexes.items():
        if table_name not in table_names:
            continue
        table_indexes = {index["name"] for index in inspector.get_indexes(table_name)}
        existing_indexes.update(expected_indexes & table_indexes)

    return existing_indexes


def _load_script_directory(alembic_ini_path: str | None) -> ScriptDirectory:
    resolved_ini_path = Path(alembic_ini_path) if alembic_ini_path else _default_alembic_ini_path()
    config = Config(str(resolved_ini_path))
    return ScriptDirectory.from_config(config)


def _default_alembic_ini_path() -> Path:
    return Path(__file__).resolve().parents[2] / "alembic.ini"
