# FleetPilot Architecture

## Product Vision

FleetPilot is an AI-assisted operating system for trucking companies.

The long-term product should connect operational data, employee work, fleet events, financial events, communications, and AI recommendations in one system.

The application should not behave like a collection of disconnected pages. Important business events should create trackable work through the Task Activity Engine.

## Current System

FleetPilot is a modular Next.js application using the App Router. React client pages call route handlers under `src/app/api`; Prisma provides typed access to PostgreSQL through a shared client in `src/lib/prisma.ts`.

Implemented product areas include:

- companies, trucks, drivers, loads, and settlements
- truck inspections and driver orientation
- employees, payroll support, escrow, and reserve tracking
- bank account and transaction ingestion through Plaid
- email inbox synchronization
- Telegram task commands
- task projects, boards, cards, labels, comments, and attachment records

The task module has a central `TaskService`, request validation, stable route error handling, Prisma transaction boundaries, and an injectable activity abstraction. Activity is currently structured console output and is deliberately best-effort. Durable task activity, authenticated actor identity, authorization, notifications, and automation remain planned work.

## Runtime Boundaries

```text
Browser or integration
  -> Next.js route handler
  -> validation and transport mapping
  -> domain service
  -> Prisma transaction
  -> PostgreSQL
```

Route handlers should remain thin. Domain services own business rules and transaction boundaries. Integrations such as Telegram, email, and future AI workflows should call the same services rather than write directly through Prisma.

## Main Modules

### Task Activity Engine

The operational center of FleetPilot.

Responsibilities:

- create and assign work
- track status and due dates
- connect work to business entities
- preserve activity history
- support recurring templates
- support notifications
- support AI-created draft tasks

### Dispatch

Responsibilities:

- loads
- assignments
- pickup and delivery tracking
- delays
- document collection
- driver communication
- service exceptions

### Fleet and Maintenance

Responsibilities:

- trucks
- inspections
- repair events
- preventive maintenance
- defects
- out-of-service events
- maintenance-related tasks

### Driver Management

Responsibilities:

- driver profiles
- truck assignment
- orientation
- documents
- pay configuration
- performance and compliance events

### Accounting and Banking

Responsibilities:

- settlements
- employee payments
- bank accounts
- transactions
- reconciliation
- financial exceptions
- payment tasks

### HR

Responsibilities:

- employees
- roles
- payroll
- onboarding
- performance
- assigned work

### Communications

Responsibilities:

- email ingestion
- Telegram ingestion
- categorization
- conversion of messages into reviewable tasks
- links back to original communication

### AI Layer

Responsibilities:

- summarize operational context
- recommend actions
- detect risks
- create draft tasks
- rank priority
- produce management reports

The AI layer must not become the source of truth. PostgreSQL remains the source of truth.

## Architectural Principles

### PostgreSQL as System of Record

All important business state must be stored in PostgreSQL through Prisma.

### Explicit Relations

Use Prisma relations for known business entities.

Examples:

- Task to Employee
- Task to Truck
- Task to Driver
- Task to Load
- Task to Email

Use generic source fields only for integration events or future entity types.

### Service Layer for Mutations

Task project and card mutations are centralized in the current task service foundation.

Current structure:

```text
src/
  lib/
    tasks/
      task-service.ts
      task-activity-service.ts
      task-route-response.ts
      task-validation.ts
      task-types.ts
```

UI and route handlers should call the task service instead of duplicating mutation logic.

### Activity History

The current activity abstraction produces best-effort structured logs. A logging failure cannot turn a committed task mutation into an API error.

The planned audit system is stronger: every meaningful task change should create a durable `TaskActivity` record in the same database transaction as the change. Best-effort operational logging and transactional audit history are separate concerns.

### Tenant and Actor Context

Company scope and authenticated actor identity are not yet enforced across the application. Before production multi-company use:

- every request must resolve its company and actor on the server
- services must validate that referenced entities belong to that company
- activity records must capture actor and source attribution
- authorization must be enforced independently of UI visibility

### Backward-Compatible Migration

The existing `assignedTo` string should not be deleted in the first migration.

Migration sequence:

1. Add `assignedEmployeeId`.
2. Update UI and API to use Employee IDs.
3. Attempt to map recognizable legacy values.
4. Verify production data.
5. Remove `assignedTo` in a later migration.

### Permissions

At minimum, plan for these permission concepts:

- view tasks
- create tasks
- edit own tasks
- edit company tasks
- assign employees
- manage templates
- manage automations
- view AI recommendations

Do not hard-code access only by UI visibility. Enforce it server-side.

## Task API Direction

The current API uses `GET` and `POST /api/tasks` plus `POST`, `PATCH`, and `DELETE /api/tasks/cards`. These routes delegate to `TaskService` and preserve existing response shapes.

Planned resource-oriented operations:

```text
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
DELETE /api/tasks/:id

POST   /api/tasks/:id/comments
POST   /api/tasks/:id/attachments
POST   /api/tasks/:id/checklist
PATCH  /api/tasks/:id/checklist/:itemId

GET    /api/tasks/:id/activity
GET    /api/employees?active=true
```

If the project uses server actions instead of REST, preserve that convention.

See [API.md](API.md) for current request fields, response behavior, and planned endpoints.

## Task Completion Rules

When status becomes `DONE`:

- set `completedAt` when currently empty
- create `COMPLETED` activity

When a completed task is reopened:

- clear `completedAt`
- create `REOPENED` activity

When status becomes `CANCELLED`:

- set `cancelledAt`
- create `CANCELLED` activity

## Observability

Important errors should include enough context for debugging without logging secrets.

Log:

- operation
- task ID
- actor ID
- source type
- failure category

Never log:

- passwords
- access tokens
- bank credentials
- full sensitive message bodies unless necessary and protected

## Planned Evolution

Architecture should evolve in small, backward-compatible stages:

1. Persist task activity atomically and expose a timeline.
2. Add authenticated actor identity, company scoping, and server-side authorization.
3. Replace legacy string assignment with an optional Employee relation through a staged migration.
4. Add task details, checklist, comments, attachments, and typed business links.
5. Route fleet, dispatch, communication, finance, and safety events into the Task Activity Engine.
6. Add notifications and policy-controlled automation.
7. Add observable AI recommendations and draft actions with human review.

Each stage must preserve existing task data and successful API contracts unless an explicit migration or versioning plan is approved.
