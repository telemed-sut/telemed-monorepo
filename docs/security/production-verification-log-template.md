# Production verification log template

Use this template when you run the production verification checklist against a
real deployment. It gives you a single place to capture evidence, pass or fail
status, and remediation ownership.

## Verification metadata

Fill in this section before you begin.

| Field | Value |
| --- | --- |
| Environment | |
| Deployment URL | |
| Date | |
| Reviewer | |
| Commit SHA | |
| Backend image | |
| Frontend image | |
| Latest successful image scan run | |

## Dependency audit evidence

Record the artifacts that support release sign-off.

| Audit | Result | Artifact link | Notes |
| --- | --- | --- | --- |
| Backend `pip-audit` | pass / fail / n-a | | |
| Frontend `bun audit` | pass / fail / n-a | | |
| Image scan | pass / fail / n-a | | |

## Production readiness checklist results

Mark each item as `pass`, `fail`, or `n-a`.

| Control | Result | Evidence | Owner if failed |
| --- | --- | --- | --- |
| `APP_ENV=production` | | | |
| `AUTH_COOKIE_SECURE=true` | | | |
| `ALLOWED_HOSTS` matches deployment | | | |
| `CORS_ORIGINS` matches deployment | | | |
| `REDIS_URL` is active and reachable | | | |
| API docs are disabled | | | |
| Admin login works | | | |
| Admin refresh works | | | |
| Admin logout revokes access | | | |
| Recent MFA is required after 15 minutes | | | |
| Patient PIN lockout triggers after repeated failures | | | |
| Legacy patient tokens without `device_ctx` are rejected or invalidated during rollout | | | |
| Patient refresh rotates the access token | | | |
| Refreshed patient token stays bound to the original device context | | | |
| Patient logout is rejected from a different device context | | | |
| Patient token rotation invalidates the older session | | | |
| Patient logout-all revokes every active patient session | | | |
| `cleanup_sessions.py` is scheduled | | | |
| Backend build uses `requirements.lock` or equivalent hashed artifact | | | |
| `X-Request-Id` reaches responses and logs | | | |
| Sensitive fields are redacted in the log sink | | | |

## Outcome summary

Close with a decision that can be handed to release owners.

- Release decision:
- Open blockers:
- Accepted risks:
- Follow-up tasks:

## Next steps

If any blocking item fails, open a remediation task and update
[security-sign-off-note-template.md](./security-sign-off-note-template.md)
instead of changing application code immediately.
