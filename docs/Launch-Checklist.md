# FleetPilot Internal Alpha — Launch Checklist

This checklist separates deployment readiness from business launch readiness.
Passing a build is not permission to operate.

## Deployment readiness

### Ownership and scope

- [ ] Alpha company, users, roles, workflows, and excluded modules approved
- [ ] Named product owner, deployment owner, database owner, and incident owner
- [ ] Production rollout blockers in security documentation reviewed
- [ ] Inbox, Telegram, QuickManage, Reserve, and TM Fund remain fail-closed or
      have separately approved ownership implementations

### Code and dependencies

- [ ] Approved PRs are merged from reviewed commits
- [ ] Prisma format, validate, generate, migration status, and schema diff pass
- [ ] TypeScript, targeted/full lint disposition, unit/integration, Playwright,
      production build, and `git diff --check` pass
- [ ] Dependency advisory matrix is current with no unexplained reachable high
      or critical advisory
- [ ] Service worker does not cache authenticated API data

### Data and migrations

- [ ] Production schema and `_prisma_migrations` history reconciled read-only
- [ ] Every pending migration manually reviewed for destructive SQL
- [ ] Database backup completed and restore tested
- [ ] Legacy null-company rows inventoried; no arbitrary ownership assignment
- [ ] Migration order, expected duration, locking, rollback, and owner recorded
- [ ] No `db push`, `migrate reset`, or `migrate resolve` used as rollout shortcuts

### Configuration and secrets

- [ ] Hosting repository, production branch, and expected SHA verified
- [ ] Environment variable names inventoried without exposing values
- [ ] Auth URL/secret and GitHub OAuth callback verified
- [ ] Database uses least-privilege credentials and TLS where required
- [ ] Plaid environment and webhook posture reviewed
- [ ] Embedded QuickManage credential removed and rotated before relevant code
      is used
- [ ] Telegram remains disabled unless webhook secret and company routing exist
- [ ] Durable private object storage configured before production uploads

### Reliability and security

- [ ] Cross-company, inactive-user, non-member, spoofed-ID, IDOR, and role tests pass
- [ ] Foreign and missing resources have equivalent non-enumerating responses
- [ ] Upload authorization, traversal, MIME sniffing, size, retention, and backup tested
- [ ] Structured logs and error reporting exclude secrets and sensitive bodies
- [ ] Health, database connectivity, error-rate, and migration alerts configured
- [ ] Rate limiting/abuse protection decided for login, DOT lookup, uploads, and webhooks
- [ ] Rollback rehearsed in staging, including schema-forward/app-back rollback

## Internal Alpha launch checklist

### Business setup

- [ ] One Alpha company and 3–10 named office users enrolled
- [ ] OWNER and backup OWNER confirmed; least-privilege roles assigned
- [ ] Trucks, trailers, drivers, employees, customers, and active loads reconciled
- [ ] Required document types and operational status definitions approved
- [ ] Time zone, currency, settlement rules, and working hours configured

### Workflow acceptance

- [ ] Operator completes load intake with required stops and resources
- [ ] Assignment conflict is detected before dispatch
- [ ] Pre-trip failure creates an equipment hold and linked task
- [ ] Pickup, in-transit exception, and delivery are recorded
- [ ] Required rate confirmation, BOL, receipt, POD, and inspection evidence is authorized
- [ ] Delivered load enters settlement readiness only when complete
- [ ] Settlement approval and reversal are attributable
- [ ] End-of-day report identifies all unresolved exceptions
- [ ] Cross-company user cannot observe or mutate any scenario record

### Training and operations

- [ ] Dispatcher, owner/admin, safety, and accounting walkthroughs completed
- [ ] Known limitations and external fallback procedures distributed
- [ ] Support channel and severity/escalation policy active
- [ ] Data correction and deletion procedure documented
- [ ] Parallel-run reconciliation owner assigned
- [ ] Daily feedback review and defect triage scheduled

### Launch gate

- [ ] Five consecutive staging operating-day scenarios pass
- [ ] Two production parallel-run days reconcile with current systems
- [ ] No unresolved severity-1 security, data-loss, financial, or dispatch defect
- [ ] All top-20 blockers are completed or explicitly removed from Alpha scope
- [ ] Product owner, security reviewer, database owner, and operations lead sign off
- [ ] Rollback decision point and rollback operator named

## Rollback checklist

- [ ] Stop writes or place Alpha in maintenance mode
- [ ] Record current deployment SHA and database migration state
- [ ] Revert application to the tested compatible version
- [ ] Prefer leaving additive schema in place; do not improvise destructive SQL
- [ ] Verify authentication, tenant isolation, and data readability
- [ ] Reconcile operations entered during the incident
- [ ] Notify Alpha users and document cause, impact, and recovery
- [ ] Preserve logs/evidence without copying secrets

## Launch decision record

| Decision | Owner | Date | Evidence/link |
| --- | --- | --- | --- |
| Product scope approved |  |  |  |
| Security approved |  |  |  |
| Migration approved |  |  |  |
| Operations acceptance passed |  |  |  |
| Go / no-go |  |  |  |

