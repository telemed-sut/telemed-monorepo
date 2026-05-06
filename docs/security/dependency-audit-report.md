# Dependency audit report

This report tracks the dependency and supply-chain audit completed on
April 10, 2026. It separates findings into three groups so the team can act on
real risk without overreacting to noise.

## Audit status

The repo includes:

- Python dependencies in `backend/requirements.txt`,
- frontend dependencies in `frontend/package.json`, and
- a Bun lockfile in `frontend/bun.lock`.

This audit is based on:

- local manifest review,
- local lockfile review, and
- package-audit tooling when available in the current environment.

If an audit tool cannot reach its advisory database from the current
environment, treat the related result as incomplete and rerun it in CI or a
network-enabled workstation before sign-off.

## Current result buckets

### Must fix now

No reachable critical dependency issue is confirmed from the current repo-only
review.

### Safe to defer

- Frontend audit tooling produced transient results in this environment. A
  successful local `bun audit` run earlier on April 10, 2026 reported `33`
  advisories (`17 high`, `16 moderate`), but the follow-up rerun failed with
  `ConnectionRefused`. The successful run clustered findings in development or
  build-time dependency chains rather than a confirmed reachable production
  auth path.
- The frontend manifest already pins `lodash` with an override to `4.17.23`,
  which reduces noise for the advisory chain that enters through charting or
  tooling packages.
- Backend dependency audit with `pip-audit` could not complete because the
  current environment could not reach the advisory service (`pypi.org`), even
  after installing the tool into the project virtual environment.
- Dependencies that may have newer patch or minor releases but do not map to a
  confirmed reachable vulnerability in the current application path.
- Tooling or test-only packages that do not ship in the production runtime.

### False positive or not reachable

- Advisories that target optional features not enabled in this deployment.
- Advisories that affect only development tooling and not the shipped runtime.
- Duplicate advisories already mitigated by pinned overrides, for example the
  `lodash` override in the frontend package manifest.

## Evidence collected in this repository

- `frontend/package.json` uses Bun for installs and Vitest/Vite in the
  development toolchain, so audit noise in this project is more likely to
  concentrate in build or test paths than in the deployed dashboard runtime.
- `backend/requirements.txt` is intentionally compact and pins exact versions
  for the FastAPI stack, database layer, and Sentry runtime.
- No dependency change was made in this hardening round because the local audit
  evidence was not stable enough to justify a safe package upgrade decision.

## Required operator reruns

Before final production sign-off, rerun dependency audit commands in a
network-enabled environment and archive the output:

1. Backend dependency audit for the Python virtual environment used in CI.
2. Frontend dependency audit against the Bun lockfile or the package manager
   used for production installs.
3. Container or filesystem scan if your release process includes image builds.

Recommended commands:

1. `cd backend && ../backend/.venv/bin/python -m pip_audit -r requirements.txt`
2. `cd frontend && bun audit`
3. Your container or artifact scanner of choice against the built image.

If you use GitHub Actions for release evidence, run
`.github/workflows/security-signoff-evidence.yml` and attach the resulting
artifacts to
[security-sign-off-note-template.md](./security-sign-off-note-template.md).

## Next steps

If a later rerun finds a critical reachable advisory, open a dedicated work
item and avoid bundling the fix with unrelated refactors.
