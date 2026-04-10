# Security sign-off note template

Use this note to close a release review for one environment. It is the final
decision record after dependency audit evidence, production verification, and
infra or ops review are complete.

## Sign-off metadata

| Field | Value |
| --- | --- |
| Environment | |
| Date and time | |
| Reviewer | |
| Release owner | |
| Commit SHA | |
| Backend image | |
| Frontend image | |

## Evidence bundle

Link the evidence used for this decision.

| Evidence | Link |
| --- | --- |
| Final audit summary | |
| Dependency audit report | |
| Frontend security audit report | |
| Production verification log | |
| Infra and ops review | |
| Latest successful image scan | |

## Decision summary

Write a short release decision here.

- Decision:
- Blocking issues:
- Accepted risks:
- Required follow-up:

## Checklist status

Summarize the overall state.

| Area | Status | Notes |
| --- | --- | --- |
| Dependency audit | pass / fail / n-a | |
| Production verification | pass / fail / n-a | |
| Infra and ops review | pass / fail / n-a | |
| Container scan | pass / fail / n-a | |

## Approval

- Security reviewer:
- Release owner:
- Approved for deployment: yes / no

## Next steps

If approval is `no`, attach remediation tasks and rerun the affected
verification steps before reopening sign-off.
