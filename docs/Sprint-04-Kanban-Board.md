# Sprint 4 — Kanban Board and Drag-and-Drop

## Objective

Deliver a responsive Kanban view backed by deterministic, transactional card
movement.

## Delivered

- Dedicated project-board read endpoint
- Dedicated card-move endpoint
- Explicit nullable board-to-status mapping
- Deterministic board and card ordering
- Contiguous integer normalization after moves
- Cross-project, stale-source, and unmapped-board protection
- Atomic board, status, order, and activity writes
- Pointer, touch, and keyboard drag-and-drop with a drag overlay
- Optimistic movement with snapshot rollback and canonical server reconciliation
- Loading, empty, not-found, error, and move-in-progress states
- Integration coverage for movement, conflicts, rollback, activity, and routes

## Status Mapping

New projects create these mappings:

| Board | Status |
| --- | --- |
| To Do | `TODO` |
| In Progress | `IN_PROGRESS` |
| In Review | `IN_REVIEW` |
| Done | `DONE` |

Legacy boards remain unmapped until deliberately reconciled. They remain
readable but cannot accept moved cards.

## Ordering and Concurrency

The service removes the moving card, inserts it at the requested post-removal
index, and assigns contiguous orders starting at zero. It validates the
expected source board and optional `updatedAt` timestamp. Serializable
transaction conflicts return `409`.

## UI Recovery

The client snapshots the canonical board state before an optimistic move.
Successful responses replace it with server ordering. Failed requests restore
the snapshot and display a visible error without reloading the page.

## Out of Scope

Comments, attachments, employee-management UI, authentication redesign,
notifications, automation, and AI features remain outside Sprint 4.
