PYTHON_BIN ?= python3
VENV_DIR ?= $(CURDIR)/venv
COMPOSE_FILE ?= docker-compose.yml
COMPOSE_OVERRIDE_FILE ?= docker-compose.override.yml
ENV_FILE ?= .env

ifneq ("$(wildcard $(ENV_FILE))","")
DOCKER_COMPOSE ?= docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) -f $(COMPOSE_OVERRIDE_FILE)
else
DOCKER_COMPOSE ?= docker compose -f $(COMPOSE_FILE) -f $(COMPOSE_OVERRIDE_FILE)
endif

.PHONY: backend-test-env deps-lock deps-sync test-matrix postgres-subset docker-rebuild docker-restart docker-refresh

backend-test-env:
	PYTHON_BIN="$(PYTHON_BIN)" VENV_DIR="$(VENV_DIR)" ./scripts/bootstrap_backend_env.sh

deps-lock:
	uv pip compile requirements.txt --python "$(VENV_DIR)/bin/python" --generate-hashes -o requirements.lock

deps-sync:
	uv pip sync requirements.lock --python "$(VENV_DIR)/bin/python" --require-hashes

test-matrix:
	./scripts/run_test_matrix.sh all

postgres-subset:
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" RUN_TEST_MIGRATIONS="$(RUN_TEST_MIGRATIONS)" ../scripts/test-backend-postgres-subset.sh

docker-rebuild:
	$(DOCKER_COMPOSE) build --pull backend

docker-restart:
	$(DOCKER_COMPOSE) up -d --force-recreate backend

docker-refresh:
	$(DOCKER_COMPOSE) build --pull backend
	$(DOCKER_COMPOSE) up -d --force-recreate backend
