# FleetPilot Database

PostgreSQL is FleetPilot's system of record. Prisma defines the application
schema and committed migrations describe every database change.

## Task Board Status Mapping

`TaskBoard.status` is a nullable `TaskStatus`.

- New default boards explicitly map to `TODO`, `IN_PROGRESS`, `IN_REVIEW`, and
  `DONE`.
- Existing boards are intentionally left nullable.
- Board names are presentation text and are never used to infer status.
- Multiple boards may map to the same status.
- Moving a card into an unmapped board is rejected.

The Sprint 4 migration adds only the nullable column:

```sql
ALTER TABLE "TaskBoard" ADD COLUMN "status" "TaskStatus";
```

No index is required for the current query pattern because board retrieval
starts from the indexed project relation and movement loads boards by primary
key.

## Card Ordering

Card order is stored as contiguous integers beginning at zero. A move
normalizes only the source and destination boards. Reads use `order`,
`createdAt`, and `id` as deterministic sort keys.

Card movement, sibling normalization, status mutation, and activity records
share one serializable Prisma transaction.
