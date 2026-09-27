# FleetPilot Internal Alpha — Business-Value Roadmap

## Roadmap principle

Sequence work by the cost of an operational failure, not by schema convenience.
The first Alpha should help a dispatcher safely move a load through a day and
help an owner see exceptions and close the day. Features outside that path stay
explicitly unavailable.

## Phase 0 — Decide the launch boundary (1–2 weeks)

Outcome: everyone agrees what FleetPilot will and will not operate.

- shadow one complete business day with dispatcher, safety, and accounting
- define company, user, employee, driver, customer, and carrier terminology
- approve the Alpha roles and sensitive mutation matrix
- choose dispatcher-entered versus driver self-service events
- inventory legacy null-company rows and assign business owners
- choose private object storage and data retention
- write the operating-day acceptance scenario and seed dataset

Exit: signed scope, data ownership map, test scenario, and rollback owner.

## Phase 1 — Control today’s dispatch (3–5 weeks)

Outcome: a dispatcher can create, assign, monitor, and finish a load.

- introduce customer/contact and trailer records
- add structured load detail, stops, appointments, references, commodity,
  notes, and actual event times
- enforce truck/driver/trailer company and availability constraints
- add active dispatch board and exception filters
- add load activity/audit events
- link tasks to load, driver, truck, and inspection context
- hide or label all unavailable integrations and finance prototypes

Exit: the scripted load can progress intake → dispatch → delivery without a
spreadsheet acting as the system of record.

## Phase 2 — Prove documents and equipment readiness (2–4 weeks)

Outcome: dispatch decisions have evidence and unsafe equipment is held.

- deploy private durable object storage
- implement typed rate confirmation, BOL, POD, receipt, inspection, and driver
  document flows
- add upload validation, retention, malware-scanning decision, and backup
- add defect severity, out-of-service hold, repair action, and release
- add document-completeness and equipment-readiness gates
- add expiry/overdue exception visibility

Exit: every dispatched and settled Alpha load has required evidence, and a
failed safety check blocks assignment.

## Phase 3 — Close the business day (2–3 weeks)

Outcome: owner and accounting can approve delivered work and see exceptions.

- make settlement lines server-calculated, attributable, reviewable, lockable,
  and reversible
- add delivered-but-incomplete and ready-for-settlement queues
- provide company-scoped revenue/cost summary without claiming GAAP accounting
- add end-of-day exception dashboard and close checklist
- add operational exports needed by the existing accounting process
- keep Plaid read-only until transaction reconciliation is implemented

Exit: the owner can explain every open load, equipment hold, missing document,
pending settlement, and urgent task at close.

## Phase 4 — Harden and launch (2–3 weeks)

Outcome: the narrow workflow is reliable enough for supervised internal use.

- reconcile approved legacy data
- complete role, IDOR, audit, upload, and cross-company regression suites
- add loading/error/empty/conflict states and accessibility corrections
- run browser/mobile acceptance and failure drills
- establish staging/prod environment inventory, migration backup/restore,
  monitoring, alerting, logs, and incident ownership
- conduct a two-day parallel run, then a limited system-of-record cutover

Exit: launch checklist is signed and rollback can be executed within the
agreed recovery objective.

## Post-Alpha value order

1. Customer communication and company-owned Inbox.
2. Driver self-service/mobile workflow.
3. Invoice/receivable and bank reconciliation.
4. Maintenance planning and compliance document expiry.
5. Payroll and company funds.
6. Telegram and QuickManage only after explicit company mappings.
7. AI recommendations after source workflows and audit data are trustworthy.

AI is deliberately last: automation trained on incomplete operational state
would amplify gaps rather than reduce work.

## Milestones and measures

| Milestone | Evidence | Target |
| --- | --- | --- |
| Dispatchable | Loads have valid resources/stops and no hidden conflicts | 100% Alpha loads |
| Document-complete | Required load and inspection evidence present | ≥95%, exceptions visible |
| Auditable | Critical mutations have verified actor and timestamp | 100% |
| Tenant-safe | Cross-company regression suite passes | 100% |
| Closeable | End-of-day exception report reconciles to operator checklist | 5 consecutive days |
| Recoverable | Backup restore and app rollback rehearsed | Within agreed RTO/RPO |

