# Task API

## Principles

- Routes are transport adapters; business rules live in `TaskService`.
- Request bodies are validated before service calls.
- Known validation errors return `400`.
- Missing task resources return `404`.
- Unexpected internal errors return sanitized `500` responses.
- Successful response shapes should remain stable unless a versioned change is planned.

## Existing endpoints

### `GET /api/tasks`

Returns task projects with ordered boards and ordered cards.

Optional query:

- `projectId`: return only the matching project while preserving the array response shape.

### `POST /api/tasks`

Creates a task project and the default boards: To Do, In Progress, In Review, and Done.

Request fields:

- `name` — required string
- `description` — optional string or null
- `color` — optional string or null
- `companyId` — optional company ID

### `POST /api/tasks/cards`

Creates a task card.

Request fields:

- `projectId` — required
- `boardId` — required and must belong to the project
- `title` — required
- `description` — optional
- `priority` — optional task priority
- `order` — optional non-negative integer

When order is omitted, the card is appended to the board.

### `PATCH /api/tasks/cards`

Updates a task card. The body must contain `id` and at least one editable field.

Editable fields:

- `boardId`
- `title`
- `description`
- `priority`
- `status`
- `assignedTo`
- `dueDate`
- `order`

`dueDate: null` clears the due date.

### `DELETE /api/tasks/cards?id=<cardId>`

Deletes a card and returns `{ "success": true }`.

## Planned endpoints

```text
GET    /api/tasks/cards/:id
GET    /api/tasks/cards/:id/activity
POST   /api/tasks/cards/:id/comments
POST   /api/tasks/cards/:id/attachments
POST   /api/tasks/cards/:id/checklists
PATCH  /api/tasks/cards/:id/checklists/:itemId
GET    /api/tasks/my
GET    /api/tasks/calendar
GET    /api/tasks/timeline
```

## Planned response conventions

- Paginated list endpoints should return items plus pagination metadata.
- Mutation responses should return the updated resource.
- Activity endpoints should sort newest-first by default and support cursor pagination.
- APIs must enforce company and user authorization server-side before production exposure.