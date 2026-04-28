from sqlalchemy import create_engine, text

from app.db.alembic_compat import (
    INDEX_BRANCH_HEAD_20260408,
    LEGACY_REVISION_20260409_0029,
    ensure_single_alembic_head,
    format_alembic_preflight,
    normalize_legacy_alembic_revision,
)


def _create_schema_for_legacy_index_branch(engine) -> None:
    statements = [
        "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)",
        "INSERT INTO alembic_version (version_num) VALUES ('20260409_0029')",
        "CREATE TABLE encounters (id INTEGER PRIMARY KEY, status VARCHAR(50))",
        "CREATE INDEX ix_encounters_status ON encounters (status)",
        "CREATE TABLE alerts (id INTEGER PRIMARY KEY, patient_id INTEGER, is_acknowledged BOOLEAN)",
        "CREATE INDEX ix_alerts_patient_id_is_acknowledged ON alerts (patient_id, is_acknowledged)",
        "CREATE TABLE login_attempts (id INTEGER PRIMARY KEY, email VARCHAR(255), created_at VARCHAR(50))",
        "CREATE INDEX ix_login_attempts_email_created_at ON login_attempts (email, created_at)",
        (
            "CREATE TABLE user_privileged_role_assignments ("
            "id INTEGER PRIMARY KEY, created_by INTEGER, revoked_by INTEGER)"
        ),
        (
            "CREATE INDEX ix_user_privileged_role_assignments_created_by "
            "ON user_privileged_role_assignments (created_by)"
        ),
        (
            "CREATE INDEX ix_user_privileged_role_assignments_revoked_by "
            "ON user_privileged_role_assignments (revoked_by)"
        ),
        "CREATE TABLE device_registrations (id INTEGER PRIMARY KEY, device_secret VARCHAR(255) NOT NULL)",
        "CREATE TABLE users (id INTEGER PRIMARY KEY, two_factor_secret VARCHAR(128))",
        "CREATE TABLE patients (id INTEGER PRIMARY KEY, email VARCHAR(255))",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def test_normalize_legacy_alembic_revision_remaps_known_stale_revision(tmp_path):
    database_path = tmp_path / "legacy-alembic.db"
    engine = create_engine(f"sqlite:///{database_path}")
    _create_schema_for_legacy_index_branch(engine)

    result = normalize_legacy_alembic_revision(f"sqlite:///{database_path}")

    assert result.normalized is True
    assert INDEX_BRANCH_HEAD_20260408 in result.message

    with engine.connect() as connection:
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()

    assert version == INDEX_BRANCH_HEAD_20260408


def test_normalize_legacy_alembic_revision_refuses_to_remap_unexpected_schema(tmp_path):
    database_path = tmp_path / "unexpected-legacy-alembic.db"
    engine = create_engine(f"sqlite:///{database_path}")
    _create_schema_for_legacy_index_branch(engine)

    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE user_sessions (id INTEGER PRIMARY KEY)"))

    try:
        normalize_legacy_alembic_revision(f"sqlite:///{database_path}")
        assert False, "expected remap to fail for unexpected schema"
    except RuntimeError as exc:
        assert LEGACY_REVISION_20260409_0029 in str(exc)
        assert "user_sessions" in str(exc)


def test_format_alembic_preflight_reports_database_revision_and_repo_head(tmp_path):
    database_path = tmp_path / "preflight.db"
    engine = create_engine(f"sqlite:///{database_path}")

    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        connection.execute(text("INSERT INTO alembic_version (version_num) VALUES ('28eb7c50e1f3')"))

    preflight = format_alembic_preflight(
        f"sqlite:///{database_path}",
        alembic_ini_path="/Volumes/P1Back/telemed-monorepo/backend/alembic.ini",
    )

    assert "database revisions=[28eb7c50e1f3]" in preflight
    assert "repo heads=[20260423_0037]" in preflight


def test_ensure_single_alembic_head_returns_current_head():
    assert (
        ensure_single_alembic_head(
            alembic_ini_path="/Volumes/P1Back/telemed-monorepo/backend/alembic.ini"
        )
        == "20260423_0037"
    )
