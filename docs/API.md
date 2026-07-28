# FleetPilot Task API

Task route handlers validate external input and delegate business mutations to
`TaskService`. Expected errors use JSON shaped as `{ "error": "message" }`.
Unexpected errors return a sanitized `500` response.

## Project Board

```text
GET /api/tasks/projects/:id/board
```

Returns the Kanban projection only: project identity and description, ordered
boards, ordered cards, and card labels. Comments, attachments, and unrelated
database fields are excluded.

Boards are ordered by `order`, `createdAt`, then `id`. Cards use the same
deterministic ordering.

## Move Card

```text
POST /api/tasks/cards/:id/move
Content-Type: application/json
```

```json
{
  "sourceBoardId": "source-board-id",
  "destinationBoardId": "destination-board-id",
  "destinationIndex": 0,
  "expectedUpdatedAt": "2026-07-28T10:00:00.000Z"
}
```

`destinationIndex` uses the destination list after removing the moving card.
The response is the canonical project-board projection after the transaction.

Relevant errors:

- `400`: invalid input, destination index, or cross-project board
- `404`: missing card, board, or project
- `409`: stale source board, stale card timestamp, serialization conflict, or
  destination board without a status mapping
- `500`: sanitized unexpected service failure

Existing task mutation endpoints remain available.
