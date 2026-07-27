# FleetPilot Architecture

## Product Vision

FleetPilot is an AI-assisted operating system for trucking companies.

The long-term product should connect operational data, employee work, fleet events, financial events, communications, and AI recommendations in one system.

The application should not behave like a collection of disconnected pages. Important business events should create trackable work through the Task Activity Engine.

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

Task mutations should be centralized.

Recommended structure:

```text
src/
  lib/
    tasks/
      task-service.ts
      task-activity-service.ts
      task-validation.ts
      task-types.ts
```

UI and route handlers should call the task service instead of duplicating mutation logic.

### Activity History

Every meaningful task change should create a `TaskActivity` record in the same database transaction as the change.

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

## Suggested Task API

Exact routing should follow the existing project style.

Potential operations:

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
