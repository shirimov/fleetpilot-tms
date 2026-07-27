# AGENTS.md — FleetPilot Development Rules

## Product

FleetPilot is an AI-powered transportation management system for trucking companies.

The system should eventually coordinate:

- Dispatch
- Fleet and maintenance
- Drivers
- Loads
- Accounting
- Banking
- Human resources
- Safety and compliance
- Email
- Telegram
- Task management
- AI-generated operational recommendations

The Task Activity Engine is the operational center of the system.

## Technology

Current stack:

- Next.js
- React
- TypeScript
- Prisma
- PostgreSQL

Before changing code, inspect:

- `package.json`
- `prisma/schema.prisma`
- `prisma/migrations`
- task-related pages
- task-related components
- API routes
- server actions
- shared types
- authentication and authorization
- Telegram integration
- email integration

## General Rules

1. Never delete or rewrite working features without a migration plan.
2. Preserve existing user data.
3. Keep changes small, reviewable, and reversible.
4. Do not merge directly into `main`.
5. Use a feature branch for every substantial change.
6. Run formatting, validation, type checking, lint, tests, and production build.
7. Do not expose or commit secrets, `.env` files, API keys, access tokens, email passwords, or Plaid credentials.
8. Prefer explicit Prisma relations instead of storing entity names as plain strings.
9. Add indexes for frequently filtered or joined fields.
10. Use database transactions when a business action writes to multiple tables.
11. Record significant operational changes in an activity or audit table.
12. AI-generated actions must be marked as AI-generated and remain reviewable.
13. AI confidence and recommendations must never silently override a human decision.
14. Use clear names. Avoid vague names such as `data`, `item`, or `thing` when a business-specific name is available.
15. Keep business logic out of UI components when practical.

## Task Activity Engine Rules

The existing Kanban experience must be preserved.

Core task entities:

- `TaskProject`
- `TaskBoard`
- `TaskCard`
- `TaskLabel`
- `TaskComment`
- `TaskAttachment`
- `TaskActivity`
- `TaskChecklistItem`
- `TaskTemplate`
- `TaskAutomation`
- `TaskNotification`

A task may optionally relate to:

- Employee
- Truck
- Driver
- Load
- Email
- Future business entities

New assignments must use an Employee relation.

The legacy `assignedTo` string may remain temporarily only for migration compatibility. Do not use it for new assignments.

Create activity records for:

- task creation
- assignment and unassignment
- status changes
- board changes
- priority changes
- due-date changes
- comments
- attachments
- checklist changes
- completion
- reopening
- cancellation

## UI Principles

The task system should support:

- Kanban view
- List view
- My Tasks
- Overdue Tasks
- AI-Created Tasks
- Task details
- Employee assignment
- Related truck, driver, load, and email
- Activity timeline
- Checklist
- Comments
- Attachments
- Due dates
- Priority
- Labels

Use a task details drawer or page so the Kanban board remains fast and uncluttered.

## AI Principles

AI may:

- suggest task priority
- summarize task context
- recommend next actions
- create draft tasks from Telegram, email, maintenance, safety, finance, and HR events
- identify overdue or blocked work

AI-created tasks must include:

- `aiGenerated`
- `aiPriorityScore` where available
- `aiSummary`
- `aiRecommendation`
- `aiConfidence`
- `sourceType`
- `sourceId` where available

AI actions should be observable, reversible, and attributable.

## Required Checks

Before presenting work as complete, run available versions of:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm test
npm run build
```

If a script does not exist, report that clearly. Do not invent a successful result.

## Commit Style

Use concise conventional commits, for example:

```text
feat(tasks): add employee assignment
feat(tasks): add activity timeline
feat(tasks): add checklist support
fix(tasks): preserve card order after drag
refactor(tasks): centralize task mutation service
```

## Current Priority

Implement FleetPilot Activity Engine v1 according to `docs/Sprint-01-Task-Activity-Engine.md`.
