PYTHON_BIN ?= python3
VENV_DIR ?= $(CURDIR)/venv

.PHONY: backend-test-env deps-lock deps-sync test-matrix postgres-subset

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
