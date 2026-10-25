# Drivers Phase 3 — controlled deployment readiness

Branch `feature/drivers-ui-redesign`, Draft [PR #99](https://github.com/shirimov/fleetpilot-tms/pull/99). This section supersedes the historical Phase 2/1 reports below. No deployment, merge, production data access, real file migration or external messaging occurred.

## Implemented

- Drivers-specific durable filesystem adapter compatible with the existing private volume: explicit production root/durability gate, private directory/file permissions, no-follow reads, safe UUID names, fsynced writes and AES-256-GCM envelopes. Configurable active key plus retained decryption keyring supports rotation without rewriting history. No shared Fuel/Accounting/Tasks storage implementation changed.
- ClamAV Unix-socket INSTREAM adapter with bounded responses and a 15-second deadline. Validated uploads first enter private quarantine with scoped scan/audit records. Only clean results release production versions. Infected/error outcomes preserve quarantined evidence and leave existing versions untouched. Production downloads require a clean timestamped receipt and encrypted storage; legacy versions default UNSCANNED and remain preserved. Development without a scanner records UNSCANNED, never CLEAN.
- Per-company configurable reminder policies and scheduled-worker command for 90/60/30-day, expired and required-missing alerts. Optional MVR issue-date review interval, UTC calculations, current-version selection, threshold catch-up, transactional unique deduplication, idempotent unchanged policy configuration and audited history. Worker gates default off. No email/SMS/Telegram delivery code or external calls are present.
- Expandable reminder history below the existing Drivers roster, with scoped profile links and pagination; approved cards, navigation, six-tab drawer and document UI remain. Existing driver audit history records generated reminders. No general TaskNotification service exists in this branch; unrelated Task Activity Engine code remains untouched.
- Encrypted per-company document backups with a repeatable-read metadata snapshot, all referenced historical/active/quarantine blobs, separate backup key, authenticated manifest, completion markers and integrity validation. Restore reconstructs files into a new private directory and preserves metadata for comparison; it never overwrites active files or changes the database. Consistency/health operations detect missing/corrupt files and global namespace orphans without deletion. Interrupted/uncertain writes remain private evidence for review.
- Operator CLI and [production runbook](Drivers-Production-Readiness.md) covering configuration, scanner/signature requirements, scheduling examples, monitoring, coordinated DB/file/key backups, restore, retention and safe rollback. No worker/timer or infrastructure was installed.

## Additive database changes

Migration `20261025080000_drivers_production_readiness` (49 repository migrations total) adds version scan status/engine/timestamp, DriverDocumentScan, DriverReminderPolicy and DriverReminder. Explicit company/driver relations, restrictive historical references, unique deduplication keys, indexes and metadata checks protect new records. Existing scan metadata defaults to UNSCANNED; no file or legacy record is fabricated as clean. The upgrade verifier applies the previous 48 migrations, inserts synthetic historical fixtures, then applies 49 and verifies driver/truck/load/settlement values remain unchanged.

## Verification

All database/file work uses disposable PostgreSQL 17.5, the existing isolated internal-network runner, ephemeral private storage and synthetic identities/files. Scanner tests use a local protocol simulator; they verify clean/infected/error handling, not malware-detection effectiveness. A real ClamAV installation/signatures and production storage were not available or contacted.

| Check                                                       | Result                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Isolated 48→49 migration preservation                       | Passed                                                                |
| Existing authenticated Drivers persistence/permission suite | 8 passed                                                              |
| Phase 2 real document/employment/browser regressions        | 6 passed                                                              |
| Existing responsive/UI suite                                | 6 passed                                                              |
| New Phase 3 actual API/database/browser/recovery suite      | 6 passed again after final recovery hardening                         |
| Full regression suite                                       | 490 passed, 0 failed                                                  |
| Prisma format / validate / generate, TypeScript             | Passed (`npx tsc --noEmit`; no typecheck npm script)                  |
| Changed-file lint / formatting                              | Passed; cached Prettier, shell/JS syntax and whitespace checks passed |
| Repository-wide lint                                        | Existing 97 errors / 108 warnings; unchanged baseline                 |
| Production build                                            | Passed                                                                |

New checks cover encrypted bytes and authorized download equality; cross-company/direct URL denial; quarantined infected/error responses; revoked permissions and unscanned download denial; 90/60/30/expired/missing/MVR reminders under concurrent workers and unchanged policy reconfiguration; audit counts; encrypted file/metadata backup restoration; missing/corrupt/orphan detection; and dashboard history/profile links. AES authentication tests reject wrong key/purpose/tampering, and production configuration tests fail closed without encryption/scanning.

Reproduce with `bash scripts/verify-drivers-db.sh --phase3-regression`. The scanner simulator is guarded to the disposable runner directory; it is not production infrastructure. An initial standalone `tsx` test invocation lacked sandbox IPC socket permission; the full isolated runner uses the authorized test execution context. A final historical-version recovery check exposed double-counting when two date revisions share one physical blob; consistency counters now deduplicate physical files while retaining separate version/scan counts, and the focused database suite passed again. Recovery also rejects tampered backups and corrupt source blobs, tests disabled policies, and restores both current/historical metadata. Environment/setup failures and corrected code failures are not counted as successful runs. Existing unrelated schema drift and repository lint findings are retained separately.

## Screenshot

[Dashboard notification history](screenshots/drivers-phase3-notifications.png) shows the authenticated application backed by disposable PostgreSQL. All identities/files are synthetic. Reminder dates intentionally advance through future thresholds in the test; this is not live operational history. The small expandable history section is the only UI addition; the approved layout and drawer are preserved.

## Deployment blockers — approval required before real-system work

1. Provision and independently verify durable private storage, production keys/escrow, host encryption, permissions, capacity monitoring and off-host backups.
2. Install/update a real ClamAV daemon/signatures; validate clean, EICAR, encrypted/unsupported content and scanner-limit behavior in approved staging. Local protocol tests do not establish antivirus efficacy.
3. Approve an inventory and historical scanning/encryption migration for legacy documents. Originals are retained; production access intentionally fails closed until they are reviewed. No automatic legacy migration or quarantine release was added.
4. Approve per-company reminder policy and install the background schedule/monitoring. External delivery remains disabled and would require separate implementation/approval.
5. Complete an approved coordinated full PostgreSQL + document + key restore/failover drill at expected production scale. Local file/metadata recovery is verified; the supplemental document backup does not replace a full database backup or a separate volume snapshot for unreferenced orphan evidence.

The implementation is prepared for controlled review; it is **not cleared for production deployment** until these gates are satisfied. Historical retention has no invented duration or automatic cleanup. OCR, authenticity verification, external reminder delivery and broader Fleet Safety remain outside scope. Fuel, Accounting, QuickManage, provider mappings and shared Task/notification business code are unchanged.

---

# Historical Phase 2 delivery

Branch `feature/drivers-ui-redesign`, Draft [PR #99](https://github.com/shirimov/fleetpilot-tms/pull/99). No merge, deployment, production connection or production migration was performed. The Phase 2 report below supersedes the historical Phase 1 report retained at the end.

## Functional additions

- **Employment:** Active, Inactive, Terminated, On Leave; Company, Owner-Operator, Lease-Operator; start/termination dates; home terminal; emergency contact name/phone/relationship; existing selected company/truck assignment; company-scoped DriverTeam relation. Unknown legacy values remain unknown. Employment and truck assignment remain separate from ELD duty status.
- **Documents:** CDL front/back, medical certificate, MVR, application, employment agreement, road test and titled other qualification documents. Administrators can upload, replace and correct issue/expiration dates. Each replacement/date correction appends a version, preserving old files and metadata. Paginated version history supports authorized downloads. Images support private preview; PDFs always download as attachments.
- **Expiration:** Current-version-only expired, cumulative 30/60/90-day, missing internal checklist and unknown-expiration tracking. Dashboard window selector counts documents across the entire selected-company roster independently of search filters. Driver-level alerts appear in Overview and Documents. UTC calendar dates include the expiration day; expiration begins the following UTC day.
- **Qualification:** Attributed append-only human review records with Pending, Reviewed or Needs Follow-up outcomes and notes. No outcome, file, expiration date or completed orientation establishes legal compliance. Existing orientation summaries remain. Broad incident/safety management stays in the future Fleet Safety module.
- **Activity:** Employment updates, uploads/replacements/date corrections, downloads/previews and qualification reviews are attributed and timestamped. Employment history records status/type/date transitions; audit metadata excludes contact/CDL values. Review, version and activity lists paginate at 20 records per page.
- **Preserved:** Approved navy/white/blue dashboard, global navigation, roster and six-tab responsive drawer; search/filter/sort/pagination; add/edit and truck assignment; scoped loads/settlements/orientation notes; loading/error/empty states. Employment badges/filter supplement assignment indicators. No fictitious duty/location/MVR-clear/safety values are introduced.

## Additive database migration

`20261025070000_drivers_employment_documents` adds nullable employment/contact/terminal/team fields and DriverTeam, DriverDocument, DriverDocumentVersion, DriverQualificationReview and DriverAudit tables (48 repository migrations total). Existing records, financial fields and integration mappings are retained; no fabricated backfill or destructive alteration occurs.

Explicit composite driver/company and team/company foreign keys enforce tenant ownership for new relations. Indexes support scoped/history/expiration queries. Unique document slots/version sequences and database date/file-size checks protect metadata. Employment/team changes and audits share transactions. Document writes lock the scoped driver and check the expected version before appending version/audit records. Stale writes return 409. UI employment edits use updatedAt conflict checks; legacy clients may omit that optional field.

The verifier first applies the previous 47 migrations, inserts synthetic legacy driver/truck/load/settlement fixtures, applies migration 48, and compares persisted values, including null new employment fields. No `db push`, production seed, schema reset or unrelated schema repair is used.

## Access and private storage

| Selected-company identity                                                    | Operational reads               | CDL/emergency contacts/documents/reviews/activity | Write | Compensation |
| ---------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------- | ----- | ------------ |
| Active OWNER / ADMIN membership                                              | Yes                             | Yes                                               | Yes   | Scoped       |
| MEMBER with linked active Employee role MANAGER / SAFETY / ADMIN             | Yes                             | Read only                                         | No    | No           |
| MEMBER with linked active Employee role DISPATCHER / LEAD_DISPATCH / UPDATER | Yes, including aggregate alerts | No                                                | No    | No           |
| Unlinked/inactive/terminated/foreign employee or unsupported role            | No                              | No                                                | No    | No           |

Employee roles do not grant company administration. Active membership, employee linkage and selected company are checked on every request. Foreign driver/document/version relationships return 404 for authorized document readers; denied document roles receive 403. Existing load/settlement/truck scoping remains. The retained driver DELETE endpoint returns 409 for every authorized own-company driver, including unlinked drivers, and never deletes. No document/version/review deletion endpoints are added.

The existing private filesystem abstraction stores random-key files in a separate `driver-documents` namespace under `PRIVATE_FILE_STORAGE_ROOT` (default `.data`, outside `public`). Storage keys are excluded from DTOs. New private directories use mode 0700 and files 0600. Public-directory storage and symlinked document namespaces are rejected. Upload streams are bounded even without Content-Length (10 MB per file plus bounded multipart metadata). Extension, MIME, signature, filename and dates are validated. Downloads verify size/SHA-256 and the full tenant/driver/document/version relationship, record access in the audit, and use private/no-store, nosniff and sandbox CSP headers. Only images may preview inline. This validation is not antivirus scanning or proof of document authenticity.

## Verification results

Reproduce with `bash scripts/verify-drivers-db.sh --phase2-regression`. Requires installed dependencies, Playwright Chromium and the existing local PostgreSQL/Node Docker images. Tests use disposable PostgreSQL 17.5, tmpfs, an internal Docker network, no published Docker ports and a dedicated loopback relay restricted to `fleetpilot_drivers_verify`. Synthetic signed sessions exercise normal authentication. No application auth bypass exists. Teardown removes the test app, relay, database, network and synthetic private storage.

| Check                                                             | Result                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Previous-47 to new-48 migration preservation                      | Passed                                                      |
| Focused Drivers unit checks                                       | 10 passed                                                   |
| Existing authenticated persistence/isolation/DELETE/browser tests | 8 passed                                                    |
| New Phase 2 real HTTP/database/browser tests                      | 6 passed                                                    |
| Existing responsive/accessibility/UI regressions                  | 6 passed                                                    |
| Full regression suite                                             | 486 passed, 0 failed                                        |
| Prisma format / validate / generate                               | Passed                                                      |
| TypeScript                                                        | `npx tsc --noEmit` passed; no `typecheck` npm script exists |
| Changed-file lint                                                 | Passed, no warnings                                         |
| Full repository lint                                              | Existing 97 errors / 108 warnings; unchanged baseline       |
| Production build                                                  | Passed                                                      |

Phase 2 independently reads PostgreSQL after employment writes; checks legacy nulls, teams, stale edit/version conflicts, downloaded bytes, private/cross-company/profile-path permissions, dispatch versus safety access, replacement/date history, invalid/oversize uploads without partial writes, attributed reviews/audits and deletion protection. A real authenticated browser edits employment, uploads a medical certificate, opens history, records a review and renders desktop/mobile views.

Initial failures are separated from final results: the broad suite inherited the browser-only AUTH_URL, breaking an unrelated Finance same-origin fixture; the runner now unsets that origin only for unit tests. A Drivers filename-normalization ReferenceError was corrected. Prisma ignored symlinked migration directories in an initial harness attempt; the harness now copies them. Existing repository lint findings remain separate. Prettier was not installed or cached and the registry refused its download; no dependency/lockfile change was made. Prisma formatting and whitespace checks passed.

Fuel, QuickManage, Accounting, shared navigation, provider configuration and financial mutation source files are unchanged by Phase 2. Their existing local tests are included in the regression suite. No Samsara implementation is present in the baseline branch; no integration was added or remapped. No live provider or production verification is claimed. Existing unrelated schema drift (index names, Fuel composite FK and trigger-managed Truck normalization) remains untouched.

## Current screenshots and design comparison

These five images show the **working authenticated application backed by disposable PostgreSQL**, with synthetic `example.test` identities and synthetic private files. They contain no production data.

- [Dashboard](screenshots/drivers-phase2-dashboard.png)
- [Employment](screenshots/drivers-phase2-employment.png)
- [Documents](screenshots/drivers-phase2-documents.png)
- [Qualification review](screenshots/drivers-phase2-qualification.png)
- [Mobile documents](screenshots/drivers-phase2-mobile.png)

The approved sidebar, white workspace, blue actions, summary cards, searchable roster and right-side six-tab drawer are preserved. Fields live within existing forms/tabs, with compact tables/badges. FleetPilot's existing global header remains; initials replace unavailable photos. The drawer remains wider than the reference for actual records and becomes full-screen on mobile. Duty, maps and unverified safety metrics remain unavailable instead of adopting illustrative design values. Non-Phase-2 screenshots below remain historical mock-fixture captures.

## Remaining limitations

- Local filesystem storage requires a durable private volume, suitable host access, encryption/backups and retention operations before any future deployment. None were configured against production. No antivirus, OCR, e-signature or authenticity verification is added. An uncertain DB commit may leave a private orphan instead of risking deletion of a committed historical file; no history cleanup runs.
- The seven required document types form a labeled internal checklist, not a configurable carrier/jurisdiction legal policy. No automatic compliance determination or background email/SMS reminders are added.
- Legacy employment remains unknown until entered. Company transfers, assignment history, ELD duty/location, integration remapping and separate team administration are outside scope. Company-local team names can be created/reused in the employment form.
- General-purpose notes/file libraries, new financial workflows and broader Fleet Safety remain outside scope. Qualification notes, private documents and audit history work here; orientation notes are preserved.

---

# Historical Phase 1 delivery (superseded above)

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
