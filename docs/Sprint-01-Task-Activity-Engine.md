# Sprint 01 — Task Activity Engine v1

## Objective

Refactor the existing FleetPilot Kanban task manager into a professional operational task system while preserving existing behavior and data.

## Branch

Create:

```bash
git checkout -b feature/activity-engine-v1
```

Do not merge directly into `main`.

## Step 1 — Inspect Before Editing

Inspect:

- current Prisma task models
- task migrations
- task pages
- Kanban components
- drag-and-drop logic
- API routes
- server actions
- task TypeScript types
- employee pages and employee-query logic
- authentication and authorization
- file upload logic
- Telegram task logic, if present

Report the relevant files before major changes.

## Step 2 — Prisma Changes

Preserve:

- `TaskProject`
- `TaskBoard`
- `TaskCard`
- `TaskLabel`
- `TaskComment`
- `TaskAttachment`

Add:

- `TaskActivity`
- `TaskChecklistItem`
- `TaskTemplate`
- `TaskAutomation`
- `TaskNotification`

Add task relations:

- optional assigned Employee
- optional creator Employee
- optional Truck
- optional Driver
- optional Load
- optional Email

Add source fields:

- source type
- source ID

Add AI fields:

- AI-generated flag
- priority score
- summary
- recommendation
- confidence

Temporarily preserve the legacy `assignedTo` string.

Add indexes for:

- project
- board
- assigned employee
- status
- priority
- due date
- truck
- driver
- load
- email
- source
- creation date

## Step 3 — Safe Migration

Generate the migration without applying it first:

```bash
npx prisma migrate dev --name activity_engine_v1 --create-only
```

Review the SQL for destructive operations.

The migration must not drop existing task data.

Then apply it locally.

## Step 4 — Central Task Service

Create or refactor a central task mutation service.

It should support:

- create task
- update task
- assign task
- move task
- update priority
- update due date
- complete task
- reopen task
- cancel task
- add comment
- add attachment record
- add checklist item
- toggle checklist item

Use Prisma transactions where a task mutation and activity record must be written together.

## Step 5 — Activity Records

Record activity for:

- created
- assigned
- unassigned
- status changed
- board moved
- priority changed
- due date changed
- comment added
- attachment added
- checklist changed
- completed
- reopened
- cancelled

Store structured old and new values when useful.

## Step 6 — Employee Assignment

Add an assignment selector using active Employee records.

Requirements:

- display employee full name
- display role when useful
- write `assignedEmployeeId`
- allow unassignment
- continue displaying the legacy string only when no Employee relation exists
- do not write new values to legacy `assignedTo`

## Step 7 — Task Details Experience

Add a task details drawer or dedicated page.

Show:

- title
- description
- status
- priority
- assignee
- creator
- start date
- due date
- completion date
- project
- board
- labels
- truck
- driver
- load
- email
- source
- AI summary
- AI recommendation
- checklist
- comments
- attachments
- activity timeline

The existing Kanban board should remain responsive.

## Step 8 — Checklist

Support:

- create item
- edit item
- reorder item
- complete item
- reopen item
- delete item

Record checklist activity.

## Step 9 — Views

Minimum required views:

- Kanban
- My Tasks
- Overdue Tasks
- All Tasks

List view is strongly recommended during this sprint if current architecture allows it safely.

## Step 10 — Validation

Validate inputs server-side.

Examples:

- title required
- project and board must exist
- board must belong to selected project
- employee must exist and be active when assigned
- AI confidence must remain within allowed bounds
- priority score must remain within allowed bounds

## Step 11 — Testing

Test:

- create task
- edit task
- drag task between boards
- assign and unassign
- complete and reopen
- due date
- priority
- comments
- attachments
- checklist
- activity timeline
- old task records
- empty projects
- inactive employees
- mobile layout
- production build

## Step 12 — Required Commands

Run the commands available in the repository:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm test
npm run build
```

Report missing scripts or failures truthfully.

## Completion Report

At the end, provide:

1. changed files
2. migration summary
3. data-loss risks
4. test results
5. build result
6. unresolved issues
7. deployment steps
8. screenshots or a description of the finished UI
9. recommended next sprint
