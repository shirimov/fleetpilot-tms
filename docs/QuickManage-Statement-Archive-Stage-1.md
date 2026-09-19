# QuickManage statement archive: Stage 1

This foundation adds a private, immutable evidence archive under Accounting → Statements. It does not post accounting transactions, expectations, bank matches, or Pilot economics. No live capture, historical backfill, merge, or deployment is part of this change.

## Schema and identity

The additive migration `20260919060000_quickmanage_statement_archive` introduces nine models: `ArchiveCompany`, `ArchiveStatement`, `ArchiveVersion`, `ArchiveLine`, `ArchiveTruck`, `ArchiveConflict`, `ArchiveInventory`, `ArchiveInventoryItem`, and `ArchiveCaptureJob`, plus the `ArchiveCoverage` view.

An explicitly approved Company binding connects a QuickManage account key and Company UUID to an existing Company, Operating Group, and TMS settlement FinancialSource. A provider Company cannot be bound across Operating Groups. A logical statement is identified by that binding and the provider statement UUID; a version adds the provider version number. PID, Truck, recipient name, statement number, and filename are never uniqueness keys. Separate Driver and Contractor UUIDs with identical display fields remain separate statements.

Versions and inventory snapshots must be sealed before transaction commit. Database triggers reject later updates/deletes and insertion of additional child rows. Constraints reject cross-scope documents, source bindings, Truck mappings, and Company membership. Referenced FinancialStatement documents are immutable. Migrations do not insert historical statements or rewrite existing financial records.

## Original evidence and normalization

Original PDF bytes use existing private FinancialStatement storage and SHA-256 deduplication. Raw provider JSON uses the same private filesystem abstraction in the `quickmanage-details` namespace. Persisted PDF, JSON, and combined checksums identify a captured bundle. Authorized downloads verify PDF bytes against the recorded checksum. Storage keys are not public URLs. Provider filenames are retained when supplied; safe human-readable display names include Company, PID, statement number, Truck, and recipient.

An identical UUID/version/bundle retry reuses the sealed version and verifies stored evidence. Changed bytes at the same provider version are preserved in `ArchiveConflict`, mark the logical statement `NEEDS_REVIEW`, and never overwrite its accepted version. A new provider version is appended and marks `SOURCE_CHANGED`; an authorized explicit review accepts the latest version. A content conflict cannot be cleared by the accept-version action.

Normalization preserves source identity, recipient type/lifecycle, work period, pay/contract method, role/status, gross, inventory total deductions, net pay, payout, trips, miles, and available YTD values. Numeric JSON tokens are preserved before parsing; money is converted directly from decimal text to signed integer minor units. Fractional cents, exponent notation, and unsupported values remain null with review issues and raw evidence. Detail `net_pay_info.deductions` is not treated as total deductions. Missing values are not invented as zero.

Ordered immutable lines retain provider IDs, description, source family, code, raw amount, normalized minor units, date, reference, Truck/unit, inclusion/skipped status, and metadata. Trips, fuel, tolls, earnings, advances, recurring deductions, fixed pay, accessorials, salary deductions, and P&L summary rows are retained. Ambiguous deductions receive no automatic accounting category.

Recipient identity is the provider payroll recipient UUID (the person record's `step_1.id`), not a same-name match. Terminated recipients and inactive Companies remain eligible. Truck mapping uses an exact VIN within the canonical Company, or Company plus normalized unit when no VIN exists, including inactive Trucks. Leading-zero source units are retained. Unresolved mappings remain `NEEDS_REVIEW`; capture never creates or reactivates Trucks or recipients.

## Inventory and completeness

Discovery reads all statement types and statuses for one provider Company, performs two complete bounded pagination scans, validates the provider total, unique identities, Company scope, terminal pagination, and identical inventory fingerprints, then seals the selected Company/PID inventory. It does not use the latest-52-PID selector as an all-history inventory. Each snapshot stores expected UUID/version/recipient/update-time identities, raw source metadata, observation time, pagination metadata, and fingerprint.

For the latest sealed snapshot per Company/PID:

- Expected = authoritative inventory identities.
- Captured = those exact UUID/version/PID/recipient/update-time identities with sealed versions.
- Missing = Expected − Captured; the UI lists exact missing UUIDs and recipients.
- Conflicting = inventory identities with unresolved content/version review.
- Unexpected = captured identities for that Company/PID absent from its inventory.
- Failed = failed/review-required or expired in-progress capture jobs.
- Complete requires Expected = Captured and Conflicting = Unexpected = Failed = 0.

Matching counts alone cannot establish completeness. Mapping/normalization readiness remains separately visible and does not invent economic posting readiness. Lists are server-paginated; overview and group totals are computed against the full inventory rather than a displayed page.

## Bounded capture and access

An administrator selects one to five inventory items per request. Durable jobs track attempts, status, safe error codes, and expiring lease tokens. Atomic claims, transaction advisory locks, database unique constraints, and commit-time lease fencing prevent concurrent duplicate versions. A retry skips completed work and reclaims expired work. Evidence and completed job state commit together. Uncertain database commits never trigger deletion of possibly committed evidence.

Provider calls are limited to the discovered read contracts: Companies, statement list/stats (read-only POST queries), statement detail, and original PDF download. Detail/PDF/detail reads reject a changing source. Requests reject redirects, cap payload sizes, use timeouts and bounded retries/Retry-After handling, and serialize provider reads with a bounded queue. The per-process queue is not a distributed rate limiter; any future acceptance run must use a single application worker until a separate multi-replica policy is implemented.

Every route requires existing financial authorization and ADMIN/OWNER access within allowed Companies and the active Operating Group. The legacy generic document download path applies archive scope too. Responses are private/no-store. Binding, inventory, capture, conflicts, and acceptance write attributable financial audit events without source payloads or credentials in logs.

The Statements workspace provides Overview, Statements, Completeness, Capture, and existing Documents. Filters include Company, PID, recipient, Truck, type, lifecycle, and archive status. Detail shows original PDF, amounts, source lines, version history, mapping state, and collapsed audit metadata. Capture is disabled by default. Fuel reconciliation remains explicitly unimplemented.

## Connection and live acceptance gate

`QUICKMANAGE_ARCHIVE_ENABLED` defaults to false. Enabling requires an explicit account key, `QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID`, and existing QuickManage client credentials. The adapter uses the existing access-token client and fixed verified API paths. Discovery verified the browser-authenticated read contracts; **server client-credential payroll authorization has not been demonstrated**. Synthetic tests do not establish live provider access. Do not copy browser tokens into the repository or silently enable this connection.

After separate authorization for a small acceptance run, first verify server read-only authorization and explicit Company mappings. Select 5–10 statement UUIDs from the private discovery manifest, covering:

1. An active Driver and a terminated Driver.
2. A Contractor, including a legitimate Driver/Contractor pair sharing Truck/PID/statement number.
3. An inactive Company and an existing inactive Truck (including 8558 where source evidence supports it).
4. A leading-zero Truck unit and an unresolved historical Truck mapping.
5. An older PID outside the latest 52 and a recent PID.
6. A statement with skipped/excluded lines and a fractional-cent source value.

Capture no more than five selected items per request. Compare downloaded original checksums and every supported header/line to source evidence; verify same-version retry, interruption/resume, exact missing identities, refresh/navigation persistence, tenant isolation, and unchanged protected financial aggregates. New-version/conflict behavior should be exercised with fixtures unless a genuine historical source change already exists; never change QuickManage to manufacture one. Resolve the nine currently unmapped provider Companies before any later broad backfill.

The discovery reference is 9,127 unique statements across 14 Companies, 310 Company/PID groups, and 141 PIDs. This change captures none of those live records. Full historical backfill remains a separately scoped and authorized phase.

## Validation and protected baseline

Fresh PostgreSQL migrations and an upgrade from the previous 36-migration schema were exercised in disposable PostgreSQL 17.5. The upgrade preserved SHA-256 fingerprints of every existing row across all 80 pre-existing tables (5,907 synthetic rows); every new archive table remained empty after migration.

Synthetic posted-Pilot regression verifies net expenses 40,955,325 minor units, 699 FinancialTransactions, 1,083 allocations, 1,083 evidence links, 698 fueling events, five matched expectations, five bank matches, five unchanged Pilot document checksums, and Truck 8558 INACTIVE before and after archive capture. No claim of a new live Alpha baseline read is made.

Focused tests cover lossless money, concurrent/idempotent capture, immutable originals and child rows, new versions, same-version conflicts, Driver/Contractor distinctions, terminated recipients, inactive Trucks, exact missing/unexpected identities, failed/resumed leases, pagination, authorization, generic document access, changed inventory timestamps, bounded provider reads, pagination instability, missing PDF/authentication, and rate limits. Full tests run files serially to avoid shared posted-fixture serializable-transaction contention; explicit archive concurrency tests still issue simultaneous operations.

Targeted browser coverage exercises the real database and production build: navigation, refresh, filters, exact missing identities, terminated detail, private original PDF download, audit, disabled capture, legacy Documents, and desktop/tablet/mobile layouts, with page-error and overflow assertions. All provider data in committed tests is synthetic.

Final exact-head checks and results are recorded in the draft PR. There is no package `typecheck` script; validation uses `npx tsc --noEmit`. Repository-wide ESLint has pre-existing errors outside this change; targeted changed-file ESLint is required to pass. Runtime provider authentication and the separately authorized small live sample remain acceptance limitations, not evidence of a completed backfill.
