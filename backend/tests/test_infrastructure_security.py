from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _service_block(compose_text: str, service_name: str) -> str:
    lines = compose_text.splitlines()
    capture = False
    block_lines: list[str] = []

    for line in lines:
        if not capture:
            if line == f"  {service_name}:":
                capture = True
                block_lines.append(line)
            continue

        if line and not line.startswith("    "):
            break
        block_lines.append(line)

    return "\n".join(block_lines)


def test_compose_uses_local_override_for_backend_bind_mount():
    compose_text = _read_text(REPO_ROOT / "docker-compose.yml")
    backend_block = _service_block(compose_text, "backend")

    assert "./backend:/app" not in backend_block


def test_compose_does_not_expose_database_port_on_host():
    compose_text = _read_text(REPO_ROOT / "docker-compose.yml")
    db_block = _service_block(compose_text, "db")

    assert '"5432:5432"' not in db_block


def test_compose_binds_app_ports_to_localhost_only():
    compose_text = _read_text(REPO_ROOT / "docker-compose.yml")

    frontend_block = _service_block(compose_text, "frontend")
    backend_block = _service_block(compose_text, "backend")
    authentik_server_block = _service_block(compose_text, "authentik-server")

    assert '"127.0.0.1:3000:3000"' in frontend_block
    assert '"127.0.0.1:8000:8000"' in backend_block
    assert '"127.0.0.1:9000:9000"' in authentik_server_block


def test_compose_defines_segmented_networks():
    compose_text = _read_text(REPO_ROOT / "docker-compose.yml")

    assert "networks:" in compose_text
    assert "  frontend-net:" in compose_text
    assert "  backend-net:" in compose_text
    assert "  db-net:" in compose_text

    frontend_block = _service_block(compose_text, "frontend")
    backend_block = _service_block(compose_text, "backend")
    db_block = _service_block(compose_text, "db")
    authentik_server_block = _service_block(compose_text, "authentik-server")
    authentik_worker_block = _service_block(compose_text, "authentik-worker")
    authentik_postgres_block = _service_block(compose_text, "authentik-postgresql")

    assert "      - frontend-net" in frontend_block
    assert "      - backend-net" in frontend_block
    assert "      - backend-net" in backend_block
    assert "      - db-net" in backend_block
    assert "      - db-net" in db_block
    assert "      - backend-net" in authentik_server_block
    assert "      - db-net" in authentik_server_block
    assert "      - backend-net" in authentik_worker_block
    assert "      - db-net" in authentik_worker_block
    assert "      - db-net" in authentik_postgres_block


def test_compose_applies_resource_limits_and_health_checks():
    compose_text = _read_text(REPO_ROOT / "docker-compose.yml")

    backend_block = _service_block(compose_text, "backend")
    frontend_block = _service_block(compose_text, "frontend")
    db_block = _service_block(compose_text, "db")
    authentik_server_block = _service_block(compose_text, "authentik-server")
    authentik_worker_block = _service_block(compose_text, "authentik-worker")
    authentik_postgres_block = _service_block(compose_text, "authentik-postgresql")

    assert "healthcheck:" in backend_block
    assert "http://127.0.0.1:8000/health" in backend_block
    assert 'cpus: "2.0"' in backend_block
    assert "memory: 1G" in backend_block
    assert 'cpus: "0.5"' in backend_block
    assert "memory: 256M" in backend_block

    assert "healthcheck:" in frontend_block
    assert "http://127.0.0.1:3000" in frontend_block
    assert 'cpus: "2.0"' in frontend_block
    assert "memory: 1G" in frontend_block
    assert 'cpus: "0.5"' in frontend_block
    assert "memory: 256M" in frontend_block

    assert 'cpus: "2.0"' in db_block
    assert "memory: 2G" in db_block
    assert 'cpus: "1.0"' in db_block
    assert "memory: 512M" in db_block

    assert "healthcheck:" in authentik_server_block
    assert "http://127.0.0.1:9000/-/health/ready/" in authentik_server_block
    assert 'cpus: "1.0"' in authentik_server_block
    assert "memory: 512M" in authentik_server_block
    assert 'cpus: "0.5"' in authentik_server_block
    assert "memory: 256M" in authentik_server_block

    assert 'cpus: "1.0"' in authentik_worker_block
    assert "memory: 512M" in authentik_worker_block
    assert 'cpus: "2.0"' in authentik_postgres_block
    assert "memory: 2G" in authentik_postgres_block


def test_compose_backend_prefers_container_safe_database_url():
    compose_text = _read_text(REPO_ROOT / "docker-compose.yml")
    backend_common_env_block = compose_text.split("services:", 1)[0]

    assert 'DATABASE_URL: "${DOCKER_DATABASE_URL:-${DATABASE_URL:?' in backend_common_env_block


def test_start_compose_loads_repo_runtime_env_files_before_compose_up():
    script_text = _read_text(REPO_ROOT / "scripts" / "start-compose.sh")

    assert 'load_env_file_if_present "$ROOT_DIR/.env"' in script_text
    assert 'load_env_file_if_present "$ROOT_DIR/.env.local"' in script_text
    assert 'load_env_file_if_present "$ROOT_DIR/backend/.env.local"' in script_text
    assert 'load_env_file_if_present "$ROOT_DIR/frontend/.env.local"' in script_text
    assert "load_default_runtime_env" in script_text


def test_start_compose_force_recreates_app_services_to_avoid_stale_restart_state():
    script_text = _read_text(REPO_ROOT / "scripts" / "start-compose.sh")

    assert 'if contains_service "backend" "${services[@]}"; then' in script_text
    assert 'if contains_service "frontend" "${services[@]}"; then' in script_text
    assert 'compose_args+=(--force-recreate)' in script_text


def test_compose_env_preflight_requires_azure_blob_secrets_for_backend_startup():
    script_text = _read_text(REPO_ROOT / "scripts" / "check-compose-env.sh")

    assert 'add_issue("missing", "AZURE_BLOB_STORAGE_CONNECTION_STRING")' in script_text
    assert 'add_issue("missing", "AZURE_BLOB_STORAGE_CONTAINER")' in script_text
    assert "Heart-sound uploads require AZURE_BLOB_STORAGE_CONNECTION_STRING" in script_text


def test_infisical_project_defaults_to_dev_environment():
    infisical_text = _read_text(REPO_ROOT / ".infisical.json")

    assert '"defaultEnvironment": "dev"' in infisical_text


def test_compose_hardens_runtime_services():
    compose_text = _read_text(REPO_ROOT / "docker-compose.yml")

    for service_name in ("frontend", "backend", "authentik-server", "authentik-worker"):
        block = _service_block(compose_text, service_name)
        assert "cap_drop:" in block
        assert "      - ALL" in block
        assert "security_opt:" in block
        assert "      - no-new-privileges:true" in block
        assert "read_only: true" in block
        assert "tmpfs:" in block
        assert "      - /tmp" in block


def test_compose_enables_init_for_all_services():
    compose_text = _read_text(REPO_ROOT / "docker-compose.yml")

    for service_name in (
        "frontend",
        "backend",
        "db",
        "authentik-postgresql",
        "authentik-server",
        "authentik-worker",
    ):
        block = _service_block(compose_text, service_name)
        assert "init: true" in block


def test_gitignore_excludes_local_compose_override():
    gitignore_text = _read_text(REPO_ROOT / ".gitignore")

    assert "docker-compose.override.yml" in gitignore_text


def test_local_compose_override_exists_for_backend_hot_reload():
    override_text = _read_text(REPO_ROOT / "docker-compose.override.yml")

    assert "./backend:/app" in override_text
    assert '"5432:5432"' in override_text


def test_backend_env_example_documents_seed_passwords_and_remote_ssl():
    env_example_text = _read_text(REPO_ROOT / "backend" / ".env.example")

    assert "SEED_ADMIN_PASSWORD=" in env_example_text
    assert "SEED_DOCTOR_PASSWORD=" in env_example_text
    assert "sslmode=require" in env_example_text


def test_emdash_preserve_patterns_do_not_whitelist_local_env_files():
    emdash_text = _read_text(REPO_ROOT / ".emdash.json")

    assert '"docker-compose.override.yml"' in emdash_text
    assert '".env"' not in emdash_text
    assert '".env.local"' not in emdash_text
    assert '".env.*.local"' not in emdash_text
    assert '".envrc"' not in emdash_text


def test_backend_ci_uses_minimum_length_test_secrets():
    workflow_text = _read_text(REPO_ROOT / ".github" / "workflows" / "backend-tests.yml")

    assert "JWT_SECRET: test-jwt-secret-key-must-be-at-least-32-chars" in workflow_text
    assert "DEVICE_API_SECRET: test-device-api-secret-must-be-at-least-32-chars" in workflow_text


def test_publish_images_workflow_scans_built_images_with_trivy():
    workflow_text = _read_text(REPO_ROOT / ".github" / "workflows" / "publish-images.yml")

    assert "security-events: write" in workflow_text
    assert "aquasecurity/trivy-action@0.33.1" in workflow_text
    assert "github/codeql-action/upload-sarif@v3" in workflow_text
    assert "severity: CRITICAL,HIGH" in workflow_text


def test_staging_compose_defines_segmented_networks_and_cookie_samesite():
    compose_text = _read_text(REPO_ROOT / "infra" / "staging" / "docker-compose.staging.yml")

    assert "networks:" in compose_text
    assert "  frontend-net:" in compose_text
    assert "  backend-net:" in compose_text
    assert "  db-net:" in compose_text

    backend_block = _service_block(compose_text, "backend")
    frontend_block = _service_block(compose_text, "frontend")
    authentik_postgres_block = _service_block(compose_text, "authentik-postgresql")
    authentik_server_block = _service_block(compose_text, "authentik-server")
    authentik_worker_block = _service_block(compose_text, "authentik-worker")

    assert "AUTH_COOKIE_SAMESITE: ${AUTH_COOKIE_SAMESITE:-lax}" in backend_block
    assert "      - frontend-net" in backend_block
    assert "      - backend-net" in backend_block
    assert "      - db-net" in backend_block
    assert "      - frontend-net" in frontend_block
    assert "      - backend-net" in frontend_block
    assert "      - db-net" in authentik_postgres_block
    assert "      - backend-net" in authentik_server_block
    assert "      - db-net" in authentik_server_block
    assert "      - backend-net" in authentik_worker_block
    assert "      - db-net" in authentik_worker_block


def test_staging_compose_enables_init_for_all_services():
    compose_text = _read_text(REPO_ROOT / "infra" / "staging" / "docker-compose.staging.yml")

    for service_name in (
        "backend",
        "frontend",
        "authentik-postgresql",
        "authentik-server",
        "authentik-worker",
    ):
        block = _service_block(compose_text, service_name)
        assert "init: true" in block


def test_frontend_next_config_sets_explicit_body_size_limits():
    next_config_text = _read_text(REPO_ROOT / "frontend" / "next.config.ts")

    assert 'const HEART_SOUND_UPLOAD_PROXY_BODY_LIMIT = "10mb";' in next_config_text
    assert "proxyClientMaxBodySize: HEART_SOUND_UPLOAD_PROXY_BODY_LIMIT" in next_config_text
    assert "bodySizeLimit: HEART_SOUND_UPLOAD_PROXY_BODY_LIMIT" in next_config_text


def test_dependabot_configuration_covers_repo_ecosystems_weekly():
    dependabot_text = _read_text(REPO_ROOT / ".github" / "dependabot.yml")

    assert 'package-ecosystem: "npm"' in dependabot_text
    assert 'package-ecosystem: "pip"' in dependabot_text
    assert 'package-ecosystem: "github-actions"' in dependabot_text
    assert dependabot_text.count('package-ecosystem: "docker"') == 2
    assert dependabot_text.count('interval: "weekly"') == 5


def test_vercel_configuration_sets_security_headers():
    vercel_text = _read_text(REPO_ROOT / "vercel.json")

    assert '"headers": [' in vercel_text
    assert '"source": "/(.*)"' in vercel_text
    assert '"key": "X-Content-Type-Options"' in vercel_text
    assert '"value": "nosniff"' in vercel_text
    assert '"key": "X-Frame-Options"' in vercel_text
    assert '"value": "DENY"' in vercel_text
    assert '"key": "X-XSS-Protection"' in vercel_text
    assert '"value": "1; mode=block"' in vercel_text
    assert '"key": "Referrer-Policy"' in vercel_text
    assert '"value": "strict-origin-when-cross-origin"' in vercel_text
    assert '"key": "Permissions-Policy"' in vercel_text
    assert '"value": "camera=(), microphone=()"' in vercel_text


def test_backend_dockerignore_excludes_sensitive_and_local_artifacts():
    dockerignore_text = _read_text(REPO_ROOT / "backend" / ".dockerignore")

    assert ".git/" in dockerignore_text
    assert "tmp/" in dockerignore_text
    assert "output/" in dockerignore_text
    assert "screenshots/" in dockerignore_text
    assert "report_screenshots/" in dockerignore_text
    assert "*.keys" in dockerignore_text
    assert "*.pem" in dockerignore_text
    assert "*.key" in dockerignore_text
    assert ".env" in dockerignore_text
    assert ".env.*" in dockerignore_text
    assert "!.env.example" in dockerignore_text
    assert "__pycache__/" in dockerignore_text
    assert "*.pyc" in dockerignore_text
    assert ".pytest_cache/" in dockerignore_text
    assert ".coverage" in dockerignore_text
    assert "htmlcov/" in dockerignore_text


def test_dockerfiles_pin_base_images_to_sha_digests():
    backend_dockerfile = _read_text(REPO_ROOT / "backend" / "Dockerfile")
    frontend_dockerfile = _read_text(REPO_ROOT / "frontend" / "Dockerfile")

    assert "python:3.11.11-slim@sha256:081075da77b2b55c23c088251026fb69a7b2bf92471e491ff5fd75c192fd38e5" in backend_dockerfile
    assert "oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981" in frontend_dockerfile
    assert "node:24-alpine@sha256:01743339035a5c3c11a373cd7c83aeab6ed1457b55da6a69e014a95ac4e4700b" in frontend_dockerfile


def test_frontend_dockerfile_healthcheck_awaits_fetch_result():
    dockerfile_text = _read_text(REPO_ROOT / "frontend" / "Dockerfile")

    assert "node --input-type=module -e" in dockerfile_text
    assert "const response = await fetch('http://127.0.0.1:3000/health'" in dockerfile_text
