# Task Database Design

## Current models

### TaskProject

Groups related work and may belong to a company. A project owns boards and cards.

### TaskBoard

Represents an ordered workflow column inside a project.

### TaskCard

Represents actionable work. Current fields include title, description, priority, status, assignment text, dates, ordering, labels, comments, and attachments.

### TaskLabel, TaskComment, TaskAttachment

Child records owned by a task card and deleted with it.

## Current invariants

- A board must belong to the card's project.
- Board and card order are non-negative integers at the API boundary.
- New cards append to the selected board when order is omitted.
- Task status and priority use Prisma enums.
- Deleting a project or board cascades to dependent task records according to the schema.

## Planned persistent activity

PR #3 should introduce an append-only task activity model.

Suggested shape:

```prisma
model TaskActivity {
  id          String   @id @default(cuid())
  projectId   String
  cardId      String?
  action      String
  actorType   String
  actorId     String?
  sourceType  String?
  sourceId    String?
  metadata    Json?
  occurredAt  DateTime @default(now())
  createdAt   DateTime @default(now())

  project TaskProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  card    TaskCard?    @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@index([projectId, occurredAt])
  @@index([cardId, occurredAt])
}
```

The exact schema must be reviewed before migration. Activity records should be written in the same transaction as the business mutation when audit reliability is required.

## Planned assignment migration

The current `assignedTo` string is temporary. Move toward a relation to `Employee` without breaking existing data:

1. Add nullable `assignedEmployeeId`.
2. Backfill recognizable assignments.
3. Update service and UI reads/writes.
4. Verify production data.
5. Remove `assignedTo` in a later migration.

## Planned business links

Tasks will need typed links to operational entities such as truck, driver, load, inspection, settlement, email, repair, and invoice.

Prefer explicit nullable foreign keys for core entities. A generic source reference can supplement these links for integrations, but should not replace important relational integrity.

## Migration rules

- Every schema change must include a Prisma migration.
- Migrations must be forward-safe and reviewed for existing data.
- Destructive changes require a staged migration.
- Add indexes for common company, assignee, status, due-date, and activity queries.
- Never store secrets in task metadata or activity payloads.