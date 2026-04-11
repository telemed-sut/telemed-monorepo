from __future__ import annotations

from pathlib import Path
import re

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PROJECT_ROOT.parent
ENV_EXAMPLE_PATH = PROJECT_ROOT / ".env.example"
DOCKER_COMPOSE_PATH = REPO_ROOT / "docker-compose.yml"

ENV_KEY_PATTERN = re.compile(r"^([A-Z][A-Z0-9_]*)=")
COMPOSE_KEY_PATTERN = re.compile(r"^\s{2}([A-Z][A-Z0-9_]*):")


def _load_env_example_keys() -> set[str]:
    keys: set[str] = set()
    for line in ENV_EXAMPLE_PATH.read_text(encoding="utf-8").splitlines():
        match = ENV_KEY_PATTERN.match(line.strip())
        if match:
            keys.add(match.group(1))
    return keys


def _load_backend_compose_keys() -> set[str]:
    keys: set[str] = set()
    in_backend_common_env = False
    for line in DOCKER_COMPOSE_PATH.read_text(encoding="utf-8").splitlines():
        if line.startswith("x-backend-common-env:"):
            in_backend_common_env = True
            continue
        if in_backend_common_env and line.startswith("services:"):
            break
        if not in_backend_common_env:
            continue

        match = COMPOSE_KEY_PATTERN.match(line)
        if match:
            keys.add(match.group(1))

    keys.update({"RUN_MIGRATIONS_ON_STARTUP", "RUN_SEED_ON_STARTUP"})
    return keys


def main() -> None:
    env_example_keys = _load_env_example_keys()
    compose_keys = _load_backend_compose_keys()

    missing_from_env_example = sorted(compose_keys - env_example_keys)
    missing_from_compose = sorted(env_example_keys - compose_keys - _env_example_only_keys())

    if missing_from_env_example or missing_from_compose:
        messages: list[str] = []
        if missing_from_env_example:
            messages.append(
                ".env.example is missing backend compose keys: " + ", ".join(missing_from_env_example)
            )
        if missing_from_compose:
            messages.append(
                "docker-compose backend env is missing .env.example keys: " + ", ".join(missing_from_compose)
            )
        raise RuntimeError("; ".join(messages))

    print("Backend env contract check passed.")


def _env_example_only_keys() -> set[str]:
    return {
        "SEED_ADMIN_PASSWORD",
        "SEED_DOCTOR_PASSWORD",
    }


if __name__ == "__main__":
    main()
