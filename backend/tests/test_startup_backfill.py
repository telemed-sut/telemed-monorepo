from app import main as app_main


class _DummySession:
    def __init__(self, bind):
        self._bind = bind
        self.commit_called = False
        self.rollback_called = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get_bind(self):
        return self._bind

    def commit(self):
        self.commit_called = True

    def rollback(self):
        self.rollback_called = True


class _DummyInspector:
    def __init__(self, tables: set[str]):
        self._tables = tables

    def has_table(self, name: str) -> bool:
        return name in self._tables


def test_startup_backfill_skips_when_users_table_is_missing(monkeypatch):
    session = _DummySession(bind=object())
    calls = {"count": 0}

    monkeypatch.setattr(app_main, "SessionLocal", lambda: session)
    monkeypatch.setattr(app_main, "inspect", lambda bind: _DummyInspector(set()))
    monkeypatch.setattr(
        app_main.auth_service,
        "backfill_bootstrap_privileged_roles",
        lambda db: calls.__setitem__("count", calls["count"] + 1) or 1,
    )

    app_main.backfill_bootstrap_privileged_roles_on_startup()

    assert calls["count"] == 0
    assert session.commit_called is False
    assert session.rollback_called is False


def test_startup_backfill_skips_when_assignment_table_is_missing(monkeypatch):
    session = _DummySession(bind=object())
    calls = {"count": 0}

    monkeypatch.setattr(app_main, "SessionLocal", lambda: session)
    monkeypatch.setattr(app_main, "inspect", lambda bind: _DummyInspector({"users"}))
    monkeypatch.setattr(
        app_main.auth_service,
        "backfill_bootstrap_privileged_roles",
        lambda db: calls.__setitem__("count", calls["count"] + 1) or 1,
    )

    app_main.backfill_bootstrap_privileged_roles_on_startup()

    assert calls["count"] == 0
    assert session.commit_called is False
    assert session.rollback_called is False


def test_startup_backfill_runs_when_required_tables_exist(monkeypatch):
    session = _DummySession(bind=object())
    calls = {"count": 0}

    monkeypatch.setattr(app_main, "SessionLocal", lambda: session)
    monkeypatch.setattr(
        app_main,
        "inspect",
        lambda bind: _DummyInspector({"users", "user_privileged_role_assignments"}),
    )
    monkeypatch.setattr(
        app_main.auth_service,
        "backfill_bootstrap_privileged_roles",
        lambda db: calls.__setitem__("count", calls["count"] + 1) or 2,
    )

    app_main.backfill_bootstrap_privileged_roles_on_startup()

    assert calls["count"] == 1
    assert session.commit_called is True
    assert session.rollback_called is False


def test_startup_backfill_logs_warning_when_super_admin_emails_have_no_matching_accounts(monkeypatch, caplog):
    session = _DummySession(bind=object())

    monkeypatch.setattr(app_main, "SessionLocal", lambda: session)
    monkeypatch.setattr(
        app_main,
        "inspect",
        lambda bind: _DummyInspector({"users", "user_privileged_role_assignments"}),
    )
    monkeypatch.setattr(
        app_main.auth_service,
        "backfill_bootstrap_privileged_roles",
        lambda db: 0,
    )
    monkeypatch.setattr(app_main, "get_settings", lambda: type("Settings", (), {"super_admin_emails": "admin@example.com"})())

    with caplog.at_level("WARNING"):
        app_main.backfill_bootstrap_privileged_roles_on_startup()

    assert session.commit_called is False
    assert session.rollback_called is True
    assert (
        "Bootstrap privileged-role backfill found no matching admin accounts for configured SUPER_ADMIN_EMAILS."
        in caplog.text
    )
