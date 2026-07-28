# Sprint 01 — Task Service Foundation

## Status

Completed and merged through PR #1.

## Goal

Create one reliable application-service boundary for task project and card operations before adding more features.

## Delivered

- centralized `TaskService`
- injectable activity service abstraction
- request validation
- consistent `400`, `404`, and sanitized `500` responses
- transactional task mutations
- board-to-project validation
- append-to-board behavior for new cards
- support for clearing a due date with `null`
- thin API route handlers
- best-effort console activity recording that cannot turn a successful mutation into an API failure

## Validation performed

- Prisma schema validation
- Prisma client generation
- TypeScript compilation
- targeted ESLint

## Architectural decisions

- API routes do not own Prisma mutation logic.
- `TaskService` owns business rules and transaction boundaries.
- Activity output remains injectable.
- Temporary console activity is non-critical and best-effort.
- Persistent audit activity will be designed separately and should be transactionally reliable.

## Deferred work

- persistent activity database model
- authenticated actor identity
- company authorization and tenant scoping
- automated tests
- task detail API
- comments, attachments, and checklists
- drag-and-drop ordering and concurrency handling

## Exit criteria

Sprint 01 is complete because the service foundation is merged to `main` and the local repository has been synchronized.