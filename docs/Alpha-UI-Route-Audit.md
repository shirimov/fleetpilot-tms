# Alpha UI Route Audit

Issue: [#21 — FleetPilot Alpha UI](https://github.com/shirimov/fleetpilot-tms/issues/21)

## Current shell

- `src/app/layout.tsx` supplies fonts and metadata only; it does not provide an authenticated application shell.
- `src/components/Sidebar.tsx` is the legacy navigation. Most older pages mount it independently, producing inconsistent page frames and a seven-item mobile bottom bar.
- `/tasks` and `/finance` do not mount the sidebar. `/loads` mounts it inside `DispatchWorkspace`.
- Authentication remains server-enforced by the APIs. The login page is intentionally outside the application shell.
- Active-company selection exists at `PATCH /api/auth/company`, but no current shell control exposes it.

## Route mapping before this change

| Route | Current experience | Navigation before change | Alpha treatment |
| --- | --- | --- | --- |
| `/` | Legacy dashboard and broken QuickManage live-gross request | Dashboard | Replace with secured operational summary; QuickManage becomes unavailable integration status |
| `/loads` | Completed dispatch workspace with Dispatch, Customers, and Trailers tabs | Loads only | Expose as Dispatch Board, Loads, Customers, and Trailers using stable query-selected tabs |
| `/tasks` | Completed Monday-inspired `TaskWorkspace` | Generic “Tasks”; no shell | Keep as canonical Task Manager and place inside the modern shell |
| `/trucks` | Working legacy CRUD page | Trucks | Expose under Fleet |
| `/drivers` | Working legacy CRUD page | Nested HR | Expose under Fleet |
| `/inspections` | Working inspection/orientation page | Inspections | Expose under Fleet |
| `/settlements` | Working settlements page | Settlements | Expose under Finance |
| `/finance` | Plaid-backed finance page without shell | Finance | Expose under Finance |
| `/companies` | Company administration page | Companies | Expose under Administration |
| `/hr/employees` | Employee management | Nested HR | Expose as HR under Administration |
| `/hr/payroll` | Payroll page | Nested HR | Keep reachable from HR workflows, not primary navigation |
| `/hr/dispatch-payroll` | Dispatch payroll page | Nested HR | Keep reachable from HR workflows, not primary navigation |
| `/inbox` | Legacy inbox UI backed by intentionally fail-closed APIs | Inbox | Mark unavailable in navigation; do not present it as operational |
| `/hr/tmfund` | Legacy TM Fund UI backed by intentionally fail-closed APIs | Nested HR | Remove from primary navigation |
| `/login` | GitHub OAuth sign-in | None | Preserve as a shell-free public route |

## Hidden completed functionality

Customers, trailers, and the dispatch board are completed views inside
`DispatchWorkspace`, but only `/loads` is currently linked. They will receive
first-class navigation links using `/loads?view=customers`,
`/loads?view=trailers`, and `/loads?view=dispatch`. No duplicate models, APIs,
or pages are needed.

The completed task board, table, drag-and-drop movement, filters, search,
drawer, checklist, comments, activity, Markdown, attachments, and mentions
already live at `/tasks`. There is no alternate hidden task route and no
generic task list to retain as the default.

## Implementation boundary

- Add one reusable client-side application shell and use it from the root
  layout, excluding `/login`.
- Remove page-local sidebar instances so every completed module receives the
  same responsive frame.
- Keep existing successful routes and APIs. Query parameters select dispatch
  workspace views without creating duplicate backend concepts.
- Do not add Prisma models, migrations, or new operational services.
- Keep fail-closed integrations fail closed and clearly unavailable.
