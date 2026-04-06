# Monitoring And Alert Runbook (Cloud Run + Cloud SQL)

## Scope

- Backend uptime
- Frontend uptime
- Cloud Run 5xx trend
- Cloud SQL CPU/storage saturation
- Privileged security recovery actions

This runbook covers the monitoring pieces that already exist in the repository
and the additional templates you can deploy for high-risk security events. The
source of truth for security recovery remains the `audit_logs` table, while the
Cloud Run backend now emits a structured stdout event for
`admin_force_password_reset` so Cloud Logging and Cloud Monitoring can alert on
it.

## A) GitHub-side alert (already in repo)

Workflow: `.github/workflows/cloud-run-uptime-check.yml`

- Runs every 15 minutes
- Resolves Cloud Run URLs dynamically from GCP
- Fails when backend `/health` or frontend root fails

Recommended:

1. In GitHub repository notification settings, enable email/Slack notification for failed Actions.
2. Add CODEOWNERS/reviewers for workflow failures.

## B) GCP native alert policy baseline (manual setup)

Create notification channels in GCP first:

1. GCP Console -> Monitoring -> Alerting -> Notification channels
2. Add Email/Slack/PagerDuty channel

Then create alert policies:

1. Backend request 5xx ratio
   - Resource: Cloud Run Revision
   - Metric: `run.googleapis.com/request_count`
   - Filter:
     - service_name = backend service
     - response_code_class = 5xx
   - Condition example:
     - ratio > 1% for 5 minutes

2. Backend p95 latency
   - Metric: `run.googleapis.com/request_latencies`
   - Aligner: p95
   - Condition example:
     - p95 > 500ms for 10 minutes

3. Cloud SQL CPU
   - Metric: `cloudsql.googleapis.com/database/cpu/utilization`
   - Condition example:
     - > 80% for 10 minutes

4. Cloud SQL disk utilization
   - Metric: `cloudsql.googleapis.com/database/disk/utilization`
   - Condition example:
     - > 85% for 10 minutes

5. Admin force password reset spike
   - Logs-based metric template:
     - `infra/gcp/alerts/admin-force-password-reset-log-metric.yaml`
   - Alert policy template:
     - `infra/gcp/alerts/admin-force-password-reset-alert-policy.yaml`
   - Deploy the metric:

```bash
gcloud logging metrics create admin_force_password_reset_count \
  --project="${PROJECT_ID}" \
  --config-from-file=infra/gcp/alerts/admin-force-password-reset-log-metric.yaml
```

   - Deploy the alert policy:

```bash
gcloud alpha monitoring policies create \
  --project="${PROJECT_ID}" \
  --policy-from-file=infra/gcp/alerts/admin-force-password-reset-alert-policy.yaml
```

   - Threshold:
     - fire when successful `admin_force_password_reset` activity is greater
       than 5 in 1 hour
   - Notification target:
     - security team email, Slack, PagerDuty, or equivalent high-priority
       channel

## C) Audit log shipping status

The repository persists audit entries in PostgreSQL through the `audit_logs`
table. That remains the canonical audit trail.

For monitoring, this repository now emits a structured Cloud Run log only for
successful `admin_force_password_reset` actions. Cloud Logging captures that log
line automatically from stdout, and the templates above turn it into a
logs-based metric plus an alert policy.

Broader audit-log shipping is not configured in this repository today. If you
want alerting for more audit actions later, extend the same structured logging
pattern or ship the `audit_logs` table into your SIEM/warehouse pipeline.

## D) Logging queries (triage quick commands)

Cloud Run backend errors:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="<BACKEND_SERVICE>"
severity>=ERROR
```

Cloud SQL errors:

```text
resource.type="cloudsql_database"
severity>=ERROR
```

Admin force password reset events:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="<BACKEND_SERVICE>"
textPayload:"\"event\":\"security_audit_event\""
textPayload:"\"action\":\"admin_force_password_reset\""
```

## E) Incident first response

1. Confirm failing endpoint and blast radius (`/health`, login, create patient).
2. Check latest deployment revision.
3. Roll back Cloud Run to previous revision if regression confirmed.
4. Record timeline in incident note (start time, impact, mitigation, root cause).
