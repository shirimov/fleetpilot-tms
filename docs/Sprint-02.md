# Sprint 02 — Task Architecture Documentation

## Goal

Document the product direction, task architecture, database strategy, API conventions, AI guardrails, and implementation sequence before expanding the task module.

## Deliverables

- `Vision.md`
- `Architecture.md`
- `Roadmap.md`
- `Database.md`
- `API.md`
- `AI.md`
- `Sprint-01.md`
- `Sprint-02.md`

Existing architecture and roadmap documents remain authoritative and are supplemented by the new focused documents.

## Review checklist

- Documentation matches the current Next.js, Prisma, and PostgreSQL implementation.
- Current APIs are distinguished from planned APIs.
- Proposed schema is clearly marked as planned, not implemented.
- Activity reliability distinguishes audit records from best-effort notifications.
- AI actions are routed through domain services and permission checks.
- Multi-company and authorization requirements are called out.
- No schema or runtime behavior changes are included in this sprint.

## Definition of done

- Documentation is reviewed through a pull request.
- Conflicting architectural statements are resolved.
- The next engineering sprint can be assigned to Codex without requiring product-level assumptions.

## Next sprint proposal

Sprint 03 should implement persistent Task Activity and Timeline support:

1. finalize the `TaskActivity` schema
2. create and validate a Prisma migration
3. write activity records atomically with task mutations
4. record actor and source metadata
5. expose a timeline read API
6. add service-level tests for creation, update, delete, and failed transactions
7. preserve current API response compatibility

## Out of scope

- UI redesign
- Kanban drag-and-drop
- comments and attachments implementation
- Telegram or email automation
- AI model calls
- broad authentication redesign