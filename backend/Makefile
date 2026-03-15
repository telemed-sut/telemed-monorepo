PYTHON_BIN ?= python3
VENV_DIR ?= $(CURDIR)/venv

.PHONY: backend-test-env test-matrix postgres-subset

backend-test-env:
	PYTHON_BIN="$(PYTHON_BIN)" VENV_DIR="$(VENV_DIR)" ./scripts/bootstrap_backend_env.sh

test-matrix:
	./scripts/run_test_matrix.sh all

postgres-subset:
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" RUN_TEST_MIGRATIONS="$(RUN_TEST_MIGRATIONS)" ../scripts/test-backend-postgres-subset.sh
