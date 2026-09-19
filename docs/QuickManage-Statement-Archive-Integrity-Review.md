# PR #80 integrity and merge-readiness review

Reviewed starting HEAD `0a11b10de796533ae4eab99fc2fb605c41523e56` against unchanged main `95bdd1e0d298479cd8baf7160ef0e5f3ea850e21`. At entry the PR was OPEN/DRAFT, MERGEABLE/CLEAN, with no review threads and a successful exact-head infrastructure check. Final HEAD and validation results are recorded in the PR body.

## Model and evidence review

| Model | Purpose and integrity boundary |
| --- | --- |
| ArchiveCompany | Explicit provider/account/Company binding, unique across Operating Groups; restrictive canonical Company, group membership, and FinancialSource relations. |
| ArchiveStatement | Logical provider UUID identity within a binding; only latest/accepted version and review status can change. |
| ArchiveVersion | Unique statement/provider-version pair; sealed normalized header, original JSON key/hash and PDF relation; BigInt monetary fields. |
| ArchiveLine | Immutable ordered source lines; unique version/source-array/order; raw amounts and structured metadata remain available. |
| ArchiveTruck | Immutable historical mapping evidence; restrictive canonical Truck reference; unknown or conflicting exact identifiers remain unresolved. |
| ArchiveConflict | Quarantined same-version/different-bundle evidence; unique bundle fingerprint; original accepted version remains untouched. |
| ArchiveInventory | Sealed Company/PID observation with fingerprint, observation time, source metadata and expected count. |
| ArchiveInventoryItem | Unique provider UUID within a snapshot with expected version, recipient, timestamp and original row metadata. |
| ArchiveCaptureJob | Mutable work state only; one job per inventory item, bounded attempts/leases, restrictive item relation. |

Existing FinancialStatement storage is reused rather than duplicated. FinancialImportRecord is an economic import staging model and is not repurposed as historical statement evidence. Every archive foreign key uses restrictive deletion. Sealed versions, inventory snapshots, child rows, Company bindings and conflicts reject modification/deletion. Referenced FinancialStatement rows are protected. Deactivating a user, Company, Truck, or recipient does not delete historical evidence.

Unique keys use the explicit provider Company/account binding, provider statement UUID and version; display filenames, names, Truck units, PIDs and statement numbers do not determine identity. Exact UUID/version/bundle retries reuse evidence, concurrent captures serialize and are constrained by database uniqueness, and different bytes for the same version remain quarantined. Job row locks hold lease ownership through evidence commit. No retry emits duplicate capture-success audit events.

Original PDFs have private random storage keys, SHA-256, byte size, MIME type, capture provenance and restrictive version references. JSON has independent private random keys and checksums with the same append-only version/conflict treatment; raw bytes remain reconstructable. Neither source uses a mutable filename path. Checksummed retrieval detects tampering; this is application/database immutability, not a claim of external WORM hardware. Rollback cleanup checks durable references and retains files on an uncertain commit. Committed source evidence is not deleted on later capture failures.

Source work dates are UTC date-only representations of explicit provider calendar dates; provider instants are parsed into UTC timestamps. Raw source timestamps remain in JSON/inventory metadata. Integer minor units are derived from preserved decimal tokens without JS floating-point conversion. Missing and ambiguous precision values remain null with raw evidence rather than invented or rounded totals. Source totals are retained independently of line totals; no reconciliation or deduction category is invented. P&L summary source structures remain in raw JSON, not posted economics.

## Completeness, access, and scale

Coverage is a per-Company/PID comparison against the latest sealed snapshot, ordered by observation time then snapshot ID. Older snapshots and identity manifests remain queryable by ID. A capture must match UUID, provider version, PID, recipient and observed update instant. Missing, conflicting/source-changed, unexpected and failed items prevent completion even when gross counts are equal. Tests include 42 expected/41 matching, 42 total captures with a replaced UUID, and 43 captures for 42 expected.

Indexes support binding/UUID lookup, version uniqueness, Company/status, PID/capture time, recipient/PID, type/lifecycle, work dates, line ordering, Truck lookup, inventory history and job leases. The scale test uses actual service capture and private synthetic files for 9,127 statements, 310 groups, 14 Companies and 8,276 terminated recipients, plus 92 extra versions. It checks full totals with page sizes of 25 and bounded read-operation counts. It is a correctness/performance smoke test, not production load certification.

Routes authenticate active users through current Company and Operating Group membership, enforce OWNER/ADMIN policy, and query only authorized Companies. Existing authorization regressions cover inactive/revoked users; archive regressions cover MEMBER, cross-group, unauthorized Company and the generic document route. UUIDs cannot bypass scope. Source requests always carry the bound provider Company. No active-recipient filter is used by inventory or completeness, and no canonical active person or Truck is required for capture.

Capture defaults disabled and requires explicit account, Operating Group and credential configuration. No startup job initiates capture. Requests select at most five identities, provider reads are queued and bounded, payload sizes and retry/backoff are bounded, and persisted jobs resume from expired leases. Authentication loss stops the batch. List/stats POSTs are the verified read-only search contract; there are no QuickManage business write endpoints. Audit payloads contain IDs, counts, checksums and safe error codes, not credentials or raw source payloads.

The UI provides Overview, paginated Statements, exact Completeness, selected Capture, version detail, original PDF, collapsed provenance, and existing Documents. It exposes no unrestricted full-backfill action. Fuel reconciliation remains outside scope.

## Narrow review fixes and validation

- Preserve ambiguous VIN/unit evidence without choosing one conflicting canonical Truck.
- Validate list filters and canonicalize inventory UUID casing.
- Add an additive migration for timezone-independent coverage and fail-closed invisible-parent insertion.
- Add real 42-item interruption/repeated-resume, failure isolation, concurrency file/line/audit, equal-count replacement, immutable snapshot, and 9,127-statement scale regressions.

Fresh migrations and upgrade from the current 36-migration main schema are required. The review upgrade preserved full-row SHA-256 fingerprints for all 80 existing tables / 5,907 synthetic rows and left all new archive tables empty. The posted-Pilot fixture asserts net expenses 40,955,325 minor units, 699 transactions, 1,083 allocations/evidence, 698 events, five MATCHED expectations, five bank matches, unchanged five document checksums and Truck 8558 INACTIVE. Scale capture additionally asserts five separate zero-economic-side-effect counts.

The final PR records focused/full tests, targeted browser validation, TypeScript, changed-file ESLint, build, runner/migrator, isolated Compose and exact-head GitHub checks. Full repository lint has existing failures on main; no unrelated lint cleanup is part of this review. Disposable containers, volumes and databases must be removed after validation.

The only live-acceptance limitation is still unverified server payroll credentials and the separately authorized 5–10 statement source-fidelity sample described in the foundation report. No live QuickManage statement or Alpha database is used for this review. Keep the PR DRAFT; do not merge, deploy or run historical backfill.
