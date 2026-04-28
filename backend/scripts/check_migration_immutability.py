from __future__ import annotations

from pathlib import Path
import os
import subprocess

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PROJECT_ROOT.parent
MIGRATION_DIR = "backend/alembic/versions"
ALLOWED_HISTORICAL_MUTATIONS = {
    "backend/alembic/versions/20260215_0007_seed_admin_doctor_users.py",
    "backend/alembic/versions/20260219_0014_device_api_nonce_and_monitor_indexes.py",
    "backend/alembic/versions/24f92b040717_create_pressure_records_table.py",
    "backend/alembic/versions/f3c0eadc46a0_create_device_error_logs_table.py",
}


def _run_git(*args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(REPO_ROOT), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _resolve_diff_base() -> str:
    explicit_base = (os.environ.get("ALEMBIC_DIFF_BASE") or "").strip()
    if explicit_base:
        return explicit_base

    github_base_ref = (os.environ.get("GITHUB_BASE_REF") or "").strip()
    if github_base_ref:
        remote_ref = f"origin/{github_base_ref}"
        try:
            return _run_git("merge-base", "HEAD", remote_ref)
        except subprocess.CalledProcessError:
            pass

    github_event_before = (os.environ.get("GITHUB_EVENT_BEFORE") or "").strip()
    if github_event_before and github_event_before != "0000000000000000000000000000000000000000":
        return github_event_before

    return _run_git("rev-parse", "HEAD~1")


def main() -> None:
    diff_base = _resolve_diff_base()
    output = _run_git("diff", "--name-status", "--find-renames", f"{diff_base}...HEAD", "--", MIGRATION_DIR)
    if not output:
        print("Migration immutability check passed: no Alembic changes detected.")
        return

    violations: list[str] = []
    for raw_line in output.splitlines():
        parts = raw_line.split("\t")
        status = parts[0]
        paths = parts[1:]
        if status.startswith("A"):
            continue
        if not paths:
            continue
        if all(path in ALLOWED_HISTORICAL_MUTATIONS for path in paths):
            continue
        violations.append(f"{status} {' -> '.join(paths)}")

    if violations:
        raise RuntimeError(
            "Existing Alembic migration files must be append-only. Found non-additive changes: "
            + "; ".join(violations)
        )

    print("Migration immutability check passed.")


if __name__ == "__main__":
    main()
