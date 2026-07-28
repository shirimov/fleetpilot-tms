# FleetPilot Product Roadmap

## Delivery Approach

FleetPilot will evolve from a connected operational database into a task-centered operating system. Each phase should deliver usable workflow improvements while preserving existing data and API compatibility.

Phase gates require:

- reviewed, forward-safe database migrations where applicable
- domain logic behind services rather than UI or integration handlers
- server-side validation and company scoping
- observable failures without secret leakage
- tests for critical business rules
- production build validation

## Current Position

The Task Service Foundation is complete. Task routes now use centralized validation and transactional service methods, but persistent activity, actor identity, authorization, task details, and advanced workflow capabilities remain incomplete.

The immediate next milestone is a durable task activity timeline. Database changes must first reconcile the existing task-table migration drift and must not risk production data.

## Phase 1 — Task Activity Engine

Goal: Create the operational foundation used by every FleetPilot module.

Delivered foundation:

- task projects, boards, and cards
- list and basic Kanban components
- central task service and validation
- transactional project and card mutations
- stable task route response behavior

Remaining deliverables:

- professional Kanban
- task details
- employee assignment
- activity timeline
- checklist
- comments
- attachments
- business relations
- task templates
- notification foundation
- automation foundation
- AI metadata foundation

Exit condition: task work is attributable, queryable, safely linked to business entities, and usable as the shared workflow layer for later phases.

## Phase 2 — Fleet Integration

Goal: Turn truck and inspection events into managed work.

Deliverables:

- truck-related tasks
- maintenance issue tasks
- inspection failure tasks
- preventive-maintenance reminders
- out-of-service workflow
- fleet dashboard exceptions

## Phase 3 — Dispatch Integration

Goal: Connect loads and service failures to tasks.

Deliverables:

- load-related tasks
- late-departure tasks
- missing-POD tasks
- temperature exception tasks
- rejected-load tasks
- driver follow-up workflow

## Phase 4 — Communication Integration

Goal: Convert email and Telegram events into reviewable work.

Deliverables:

- email-to-task
- Telegram-to-task
- source message links
- AI summaries
- duplicate detection
- approval workflow

## Phase 5 — Accounting Integration

Goal: Manage financial exceptions and recurring accounting work.

Deliverables:

- settlement review tasks
- unpaid invoice tasks
- reconciliation tasks
- payroll workflow
- suspicious transaction review
- recurring close checklist

## Phase 6 — Safety and Compliance

Goal: Track compliance deadlines and corrective action.

Deliverables:

- document-expiration tasks
- inspection corrective action
- driver compliance tasks
- safety incident workflow
- recurring audit templates

## Phase 7 — AI Operations Assistant

Goal: Provide management intelligence without removing human control.

Deliverables:

- daily operational summary
- overdue-risk prediction
- recommended task priority
- workload balancing
- management alerts
- draft executive decisions
- AI-created tasks requiring review

## Phase 8 — AI CEO Dashboard

Goal: Give company leadership one view of operations.

Deliverables:

- company health score
- fleet availability
- load service performance
- cash flow risks
- employee workload
- open critical tasks
- AI recommendations with evidence

## Cross-Cutting Work

The following capabilities progress alongside the product phases:

- authentication, company isolation, and role-based authorization
- audit history and operational observability
- idempotency for integrations and retried commands
- file storage and attachment security
- data retention, backup, and recovery
- automated tests and deployment checks
- mobile usability and accessibility

## Sequencing Rules

- Do not automate a workflow before its manual task process is reliable.
- Do not let integrations bypass domain services.
- Do not allow AI recommendations to silently override human decisions.
- Do not remove legacy fields until production data is migrated and verified.
- Do not treat notifications or console logs as durable audit history.
- Do not begin executive scoring until underlying operational metrics are trustworthy.
