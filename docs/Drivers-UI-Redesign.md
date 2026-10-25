# FleetPilot Drivers UI Redesign — implementation brief

Status: approved visual direction; implementation in progress on feature branch. Do not deploy or merge without review.

## Goal
Upgrade the existing `/drivers` route, preserving its CRUD functionality, driver records, company isolation, authorization, and links to trucks. Do not create a second Drivers module.

## Visual direction
Use the approved clean, spacious desktop dashboard: dark navy global navigation, bright off-white workspace, restrained blue accents, readable typography, subtle borders, compact color-coded badges, responsive layouts, and accessible keyboard controls. Reuse the project's existing app shell and UI conventions rather than introducing a duplicate sidebar.

## Dashboard
Header: Drivers, supporting description, Add Driver button. Summary cards for total, active, on duty, off duty, and documents expiring, but only when backed by real fields/data. Search by name, ID, phone, license; filter by verified status, truck assignment, and company as authorized. Sortable responsive roster with name, phone, truck, pay type/rate, and available real status indicators. Clicking a driver opens a right-side details drawer; include a link to a full profile view. Preserve add/edit and truck assignment; provide confirmations, loading/empty/error states. Never display fictitious counts or sample driver records as production data.

## Driver profile tabs
Overview, Documents, Assignments & Trips, Pay & Settlements, Safety, Notes & Files. Each tab must use existing relations/APIs where possible. If underlying data is unavailable, show an honest empty state, not fabricated records or metrics. Keep Safety as a separate Fleet module in future, with a driver-level read-only summary here.

## Security/data integrity
Honor company-scoped APIs and permissions; never leak driver PII or pay rates across companies. Do not change driver identity, truck links, settlement data, or historic records. Do not infer duty status from a truck being assigned. Keep Samsara/QuickManage integrations read-only until mapping and authorization are verified. Avoid destructive delete in the redesigned UI unless the existing protected workflow is explicitly preserved.

## Delivery
1. Inspect AGENTS.md, existing app shell, `src/app/drivers/page.tsx`, API routes, Prisma Driver model and related records.
2. Implement the roster dashboard and profile drawer first, keeping code typed and modular.
3. Implement tabs incrementally using verified data and server-side permissions.
4. Add tests for filters, navigation, CRUD regression, company isolation, and empty/error states.
5. Run available Prisma validation, typecheck, lint, tests, and build; report unavailable scripts and blockers.
6. Provide screenshots, a change summary, and a draft PR for review. Never merge/deploy automatically.
