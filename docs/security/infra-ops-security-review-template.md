# Infra and ops security review template

Use this template for operator-run checks that the repository cannot prove on
its own. This review complements, but does not replace,
[production-security-readiness-checklist.md](./production-security-readiness-checklist.md).

## Review metadata

Complete this section before you start.

| Field | Value |
| --- | --- |
| Environment | |
| Review date | |
| Reviewer | |
| Infra owner | |
| Deployment platform | |

## Platform and transport

Record the current state and the supporting evidence.

| Control | Result | Evidence | Notes |
| --- | --- | --- | --- |
| TLS terminates on approved hosts only | | | |
| HTTPS redirect is enforced | | | |
| Reverse proxy forwards trusted client IP headers only | | | |
| Public ingress exposes only approved ports and services | | | |

## Secrets and configuration

Use this section to verify how the runtime receives and protects secrets.

| Control | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Secret source is approved | | | |
| Rotation policy exists for JWT, OIDC, device, and meeting secrets | | | |
| Runtime does not fall back to plaintext secret storage | | | |
| Staging and production config differ only where documented | | | |

## Data protection and recovery

Check the controls that matter for closed-system and health-sensitive data.

| Control | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Backup schedule is active | | | |
| Restore procedure is documented | | | |
| Latest restore or DR drill succeeded | | | |
| Redis availability and persistence match release expectations | | | |

## Monitoring and incident readiness

Confirm that the environment is observable enough for safe release.

| Control | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Request IDs reach monitoring and logs | | | |
| Sentry or equivalent monitoring is enabled where required | | | |
| Alert routing reaches the on-call owner | | | |
| Emergency recovery path was reviewed this cycle | | | |

## Closed-system operational sign-off

Use this section for the non-code controls that still affect security.

| Control | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Shared workstation policy is in force | | | |
| Admin re-auth expectations are communicated | | | |
| Trusted-device retention is accepted by support owners | | | |
| Emergency recovery was tested in the target environment | | | |

## Next steps

If any control fails, classify it as `config fix`, `infra fix`, or
`code fix`, then attach the result to
[security-sign-off-note-template.md](./security-sign-off-note-template.md).
