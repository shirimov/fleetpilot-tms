# Drivers redesign delivery

Development continues on `feature/drivers-ui-redesign`, PR #99. The follow-up verifies actual PostgreSQL persistence and authorization, preserves the approved UI, and does not merge or deploy. All 47 repository migrations applied to a fresh disposable PostgreSQL 17.5 database. Eight authenticated database/browser tests and all 482 regression tests passed.

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

The redesigned UI does not expose destructive deletion. The retained DELETE endpoint now returns 409 for an authorized request against any existing same-company driver, including an unlinked driver. It never performs a delete. Foreign/nonexistent records remain 404; unauthorized staff writes remain 403. Future archival must be a separate reviewed, audited workflow.

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

## Verified PostgreSQL follow-up

### Isolation and migrations

- Fresh `postgres:17.5-alpine`, database `fleetpilot_drivers_verify`, ephemeral tmpfs storage, dedicated Docker network marked internal, and no published Docker ports. A persistent relay exposes only `127.0.0.1:15439` to the local tests; it connects exclusively to this disposable database.
- All **47 repository migrations** applied through `prisma migrate deploy`. No production/staging backup, source data, seed or credentials were imported. No migration or Prisma schema source was changed.
- Fixtures use `example.test` identities and two synthetic companies. Authentication uses externally generated signed test sessions and the ordinary application auth/proxy/route handlers; no application authentication bypass was introduced.
- The new runner refuses existing named containers/networks and occupied app/database ports, overwrites its own process connection URL with the guarded test URL, and tears down its containers, network, app and relay on exit. Fresh-run verification and teardown passed.
- A schema diff reports existing differences outside Drivers: index names, an additional composite Fuel policy FK, and the trigger-backed non-null Truck normalization column. These migrated protections were retained; no `db push`, reset or unrelated schema repair was used.

### Real persistence and isolation

Eight tests in `tests/integration/drivers-database.spec.ts` use actual authenticated HTTP requests and independent Prisma/PostgreSQL assertions:

1. Create, edit, retrieve, unassign and reassign a driver; verify values directly in PostgreSQL, including numeric pay values and company ownership. A submitted foreign company ID cannot override the active company.
2. Restrict roster/profile access to the selected company; include only its loads and settlements; exclude settlements with a foreign truck or foreign load; withhold foreign truck associations and orientation signatures without changing stored mappings.
3. Reject foreign-driver writes, foreign-truck assignment and invalid pay values without altering the existing record. The acting administrator belongs to both companies, proving active-company scoping rather than merely membership in either company.
4. Grant verified dispatch staff operational reads, with null pay fields, no settlement payload, explicit read-only capabilities, and denied create/update/delete requests. Unrelated truck and settlement APIs stay denied.
5. Deny unlinked employees, inactive employees and employee links belonging to another company.
6. Reject deletion for both OWNER and ADMIN and confirm the driver, truck link, three linked loads, three settlements and orientation remain unchanged. Preserve an unlinked driver too.
7. Verify each allowed operational job role, immediate access revocation after termination, inactive-user denial, and rejection of an unrecognized custom role label.
8. Exercise a genuinely authenticated staff browser: Drivers navigation appears, unrelated Accounting navigation remains hidden, Add/Edit/pay filters are disabled, the approved drawer opens and the compensation tab explains its restriction.

### Read and write permissions

| Verified identity                                                                                                               | Driver reads            | Driver create/edit | Compensation/settlements | DELETE                   |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------ | ------------------------ | ------------------------ |
| Active selected-company OWNER / ADMIN                                                                                           | Yes                     | Yes                | Yes, company scoped      | 409, record preserved    |
| Active MEMBER with linked same-company active Employee in DISPATCHER, LEAD_DISPATCH, UPDATER, MANAGER, SAFETY or ADMIN job role | Operational fields only | No                 | No                       | 403                      |
| Ordinary MEMBER, unlinked/inactive/terminated/foreign-company employee, OTHER/custom job label                                  | No                      | No                 | No                       | Denied                   |
| Anonymous or foreign-company record                                                                                             | No                      | No                 | No                       | 401 or 404 as applicable |

There is no dedicated FLEET membership role in the current schema. Existing manager/safety job roles cover fleet readers; a custom role/department string does not grant access. Employee job roles do not grant company ADMIN privileges. The proxy exception permits only Drivers GET routes, and the server rechecks the user, company membership and employment on every request. General MEMBER module restrictions remain unchanged. Capability fields/headers are server-derived presentation hints, never authorization inputs.

### Existing modules

The diff from the initial PR commit `8ec1e68` contains **no changes** to Fuel/finance business logic, Accounting/settlement logic, QuickManage/provider code, Trucks/Loads business logic, Prisma schema or migrations. Shared changes are limited to the Drivers GET authorization exception, a Drivers-only navigation capability and additive company-context metadata. Generic module restrictions and unrelated API responses remain covered by the passing tests.

No Samsara implementation exists in this branch; separate Samsara development was not edited or exercised. No live QuickManage/Samsara provider mapping or sync is claimed. Existing financial/provider regression tests, including the 9,127-capture synthetic QuickManage archive scale test, passed against the isolated database.

## Validation results

| Check                                              | Result                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Repository migration deployment                    | 47/47 passed on fresh PostgreSQL 17.5                                                            |
| Focused authenticated database/browser suite       | 8/8 passed; repeated from a second fresh database using the committed runner                     |
| Drivers validation/access/projection tests         | 6/6 passed                                                                                       |
| Approved Drivers UI regression suite               | 6/6 passed; existing design screenshots retained                                                 |
| Full `npm test`                                    | **482 passed, 0 failed**, approximately 275 seconds                                              |
| Prisma format / validate / generate                | Passed; no schema changes                                                                        |
| TypeScript                                         | `npx tsc --noEmit` passed; no `typecheck` npm script exists                                      |
| Lint for changed source and tests                  | Passed                                                                                           |
| Full repository lint                               | Existing **97 errors / 108 warnings** outside these changes remain; not a clean full-lint result |
| Production build                                   | Passed                                                                                           |
| Formatting / shell syntax / diff whitespace        | Passed                                                                                           |
| Reproducible isolated runner and automatic cleanup | Passed                                                                                           |

**Environment failures versus code failures:** initial attempts using an unavailable database or a new Docker exec for every TCP connection produced connection/transaction startup errors. Replacing that transport with one persistent local relay removed the timing artifact without relaxing application transaction timeouts or weakening Docker isolation. The completed full regression run has zero failures. An expanded test initially expected 401 for an inactive signed-in account; it was corrected to assert the existing proxy's 403 denial contract. Existing repository-wide lint failures and the schema diff described above are separate pre-existing findings, not reported as passing.

No staging/production data was accessed or modified. Test fixture cleanup used only IDs created by each test run; the disposable database was then destroyed. No deployment, merge, live integration sync or financial posting was performed. Document storage, qualification metrics and a standalone full-profile page remain the previously documented product/backend gaps.

## Reproduce database verification

Requirements: Docker running; locally available `postgres:17.5-alpine` and `node:20-bookworm-slim` images; installed repository dependencies and Playwright Chromium; unused loopback ports 15439 and 3124. The runner does not pull images or use an existing database.

```sh
bash scripts/verify-drivers-db.sh
# Optional: also run the full regression suite before automatic teardown.
bash scripts/verify-drivers-db.sh --regression
```

The runner logs migrations, app startup, relay startup and test results to its printed temporary directory. Its database suite refuses a URL other than the dedicated disposable database and requires the dedicated test-only auth secret.
