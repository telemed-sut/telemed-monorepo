PYTHON_BIN ?= python3
VENV_DIR ?= $(CURDIR)/venv

.PHONY: backend-test-env test-matrix

backend-test-env:
	PYTHON_BIN="$(PYTHON_BIN)" VENV_DIR="$(VENV_DIR)" ./scripts/bootstrap_backend_env.sh

test-matrix:
	./scripts/run_test_matrix.sh all
