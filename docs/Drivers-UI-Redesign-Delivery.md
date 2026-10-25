# Drivers redesign delivery

Work is based on the existing `feature/drivers-ui-redesign` branch and its approved implementation brief. The original local checkout was on a Fuel branch; the implementation commit was replayed onto the remote Drivers branch so the PR excludes unrelated Fuel changes.

## Implemented

- Existing `/drivers` route redesigned with a white/light-gray workspace, blue accents, five summary cards, initial avatars, status badges, and responsive roster. Existing global navy navigation, account menu and company selector are reused.
- Search across name, full driver ID, phone, email, CDL and truck number. Assignment and pay-type filters, name/newest/truck sorting, reset controls, and 8/25/50-row pagination.
- Summary counts use the entire selected-company roster, independent of search filters. Only total drivers and linked/unlinked truck counts are calculated. Duty and document expiration cards display unavailable states, not invented values. Failed requests display dashes rather than false zeros.
- Right-side profile drawer with focus containment, Escape dismissal, restored trigger focus, accessible keyboard tabs, loading/error/retry states and mobile full-screen layout.
- Existing add/edit fields and API contracts retained, with successful-save confirmation, failed-save field preservation, disabled duplicate submission, and confirmation before discarding changed values.
- Truck picker reads all pages, including inactive trucks to preserve existing assignments. Server validates selected-company ownership rather than permitting assignments across two companies merely because a user belongs to both.
- Typed input validation rejects missing names, invalid emails, invalid pay types and non-finite/negative rates; percentages cannot exceed 100. User-supplied company ownership is ignored.
- Company-scoped profile API uses explicit projections, limits related-record reads, excludes orientation signatures, and returns private/no-store headers. Foreign-company truck details are withheld. Existing foreign assignments are flagged for review and blocked from UI editing; mappings are not repaired automatically.

## Profile sections

| Section             | Operational                                                                                                                                              | Backend work still needed                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Overview            | Personal/contact fields, company, truck, pay agreement, record creation date, recent linked loads                                                        | Employment/hire dates, employment type, home terminal, active/inactive and duty status                        |
| Documents           | Existing CDL number                                                                                                                                      | Document records, secure uploads/downloads, medical certificates, MVR reports, expiration dates and reminders |
| Assignments & Trips | Latest 100 selected-company linked loads, routes, statuses, dates, recorded mileage and load trucks; Dispatch link                                       | Separate truck-assignment history, provider location and duty integrations                                    |
| Pay & Settlements   | Pay type/rate, latest 100 linked settlements within selected-company truck/load scope, recorded pay/deductions/net pay, paid flag/date; Settlements link | Live payment verification; new financial workflows are outside this change                                    |
| Safety              | Latest 25 linked orientation summaries, completion dates and notes                                                                                       | Qualification, MVR status, violation history, safety scoring and future Fleet → Safety connection             |
| Notes & Files       | Existing orientation notes and record timestamps                                                                                                         | General driver notes, attachments and complete audit history                                                  |

No standalone full-profile route is added; all six sections remain in the dashboard drawer. Load and settlement lists are explicitly bounded to their latest 100 records, and orientation lists to 25. They do not claim all-time totals.

The redesigned UI does not expose destructive deletion. The existing protected DELETE endpoint is retained for compatibility; no endpoint was invoked against real data. Future archival/deletion UI should be a separate reviewed change with relation checks and audit support.

## Comparison with approved images

| Design reference                                     | Result                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navy sidebar / bright workspace / blue accents       | Reuses FleetPilot navigation; Drivers workspace follows the approved palette and spacing. Shared global header remains dark to avoid changing unrelated modules. |
| Five summary cards and searchable, paginated roster  | Implemented. Assigned/unassigned counts replace unsupported employment statuses; duty/expiration cards explicitly state missing data.                            |
| Driver photos and identity                           | Uses initials because no driver photo field exists. Displays actual record ID suffix; full ID remains searchable.                                                |
| Right-side profile                                   | Implemented as an accessible overlay drawer. Wider than the reference to accommodate six tabs and actual financial/trip tables; full-screen on mobile.           |
| Detailed documents, trip, pay and safety screens     | Uses all available scoped relations. Documents and unsupported safety metrics show honest explanations instead of illustrative design numbers.                   |
| Maps, live location, terminal and employment filters | Omitted because the current Driver model supplies no reliable source. No fabricated location, performance metric, status or review date.                         |

## Screenshots

All screenshots show **synthetic Playwright fixtures**, served only through browser request interception. The production application contains no sample records or authentication bypass. Screenshots demonstrate rendered UI and interactions, not a live database or provider verification.

- [Desktop dashboard](screenshots/drivers-dashboard-desktop.png)
- [Desktop overview drawer](screenshots/drivers-profile-desktop.png)
- [Tablet dashboard](screenshots/drivers-dashboard-tablet.png)
- [Mobile dashboard](screenshots/drivers-dashboard-mobile.png)
- [Mobile drawer](screenshots/drivers-profile-mobile.png)
- [Documents](screenshots/drivers-documents.png)
- [Assignments and trips](screenshots/drivers-assignments-trips.png)
- [Pay and settlements](screenshots/drivers-pay-settlements.png)
- [Safety](screenshots/drivers-safety.png)
- [Notes and files](screenshots/drivers-notes-files.png)

## Validation

- Prisma format, validate and generate: passed; no schema or migration changes.
- TypeScript: no `typecheck` npm script exists; `npx tsc --noEmit` passed.
- Drivers source/test lint: passed. Full repository lint: 97 errors and 108 warnings in existing files outside this change.
- Isolated Drivers validation/projection tests: 3 passed, no database required.
- Browser suite: 6 passed. Covers search, assignment filtering, pagination, all six sections, settlement presentation, desktop/tablet/mobile rendering, viewport overflow, tab keyboard navigation, focus restoration, successful create/edit request contracts, failed save preservation, roster/profile retry, empty states and actual anonymous API rejection.
- Full `npm test` on the final branch with a deliberately unreachable local test database: 481 tests, 135 passed, 346 failed. Failures are database connection/setup failures, including health returning 503 when its database is unavailable. This is not a successful full integration run.
- Production build: passed.
- Prettier formatting and `git diff --check`: passed.

The local preview uses an unused loopback database port. Browser CRUD tests intercept requests and do not persist records. No staging/production database, migration, seed, integration sync, deployment or merge was performed. Live company-isolation, persistence and QuickManage/Samsara mapping verification still require an authorized isolated database/provider environment.

## Reproduce UI checks

Start a local server on `127.0.0.1:3124` with test-only auth values, integrations disabled and `DATABASE_URL` pointing to an unused local port. Run:

```sh
npx playwright test --config playwright.drivers.config.ts
npx tsx --test src/lib/fleet/driver-profile.test.ts
```

The browser suite installs synthetic fixtures itself. The anonymous-access test uses the actual protected endpoints without fixtures.
