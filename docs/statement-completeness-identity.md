# QuickManage completeness identity

Coverage means completeness against the **user-attested captured inventory
snapshot**, not independent proof of all QuickManage history.

## Reproduction and root cause

The five accepted provider UUID/version pairs are regression fixtures in
`tests/fixtures/quickmanage-accepted.ts`. Names, recipient IDs, Companies,
documents and economics in that fixture are synthetic. The fixture preserves
the five UUID/version pairs, timestamp shapes, two PIDs, 71-line count and
three fractional-cent raw values.

Before the fix, five sealed versions and five PDF/JSON pairs produce coverage
0/5. For example, inventory `updated_date` is
`2026-09-18T20:39:47.725261Z`, retained verbatim in the inventory item's text
column. JavaScript Date projects this to `2026-09-18T20:39:47.725Z`;
Prisma persists `providerUpdatedAt` in PostgreSQL timestamp(3) as
`2026-09-18 20:39:47.725`. The old view casts the inventory text to
timestamptz and then UTC timestamp, preserving PostgreSQL microseconds:
`2026-09-18 20:39:47.725261`. Exact SQL equality fails by 261 microseconds.
The item-level JavaScript comparison instead truncates both values, causing
disagreement between item flags and aggregate coverage.

## Identity and timestamp semantics

Provider identity is the bound QUICKMANAGE Company/account plus statement UUID
and provider version. Coverage also requires a sealed version, matching PID,
recipient ID and recipient type. Timestamp is **not** an identity discriminator.

UUID/version uniqueness, original PDF/JSON SHA-256 and bundle checksums remain
unchanged. Identical UUID/version/content is idempotent; different content at
the same version is quarantined as a conflict; a new version is separate
immutable evidence and requires explicit acceptance. A timestamp-only inventory
change does not hide existing UUID/version evidence. If subsequently submitted
source bytes differ, checksum conflict protection still applies.

Timestamps still matter for **capture freshness**, including resumed captures,
and inventory manifest stability. A shared provider-instant function requires
an explicit zone, validates calendar/time fields, converts whole seconds to UTC,
and preserves all source fractional digits (up to the bounded 100-digit input).
Trailing fractional zeros are removed. Equivalent offsets/precision serialize
identically; different instants, including differences below a millisecond or
microsecond, remain different. Missing optional timestamps are null; malformed
or zone-less values are rejected. JavaScript Date / database timestamp(3) is
only a display/storage projection and is never used for freshness equality.

Inventory fingerprints canonicalize updated_date and sort field keys; original
metadata remains untouched. Existing pre-fix fingerprints are not rewritten:
an identical inventory retry compares the sealed item's metadata canonically
in memory and returns the prior snapshot. PDF/detail/page checksums continue to
hash original bytes; semantic equivalence must never erase evidence differences.

## Migration and immutability

`20260919180000_archive_coverage_provider_identity` replaces the existing
ArchiveCoverage view. A view migration is necessary because overview, list and
detail aggregate reads share that database view. Patching a UI count would leave
the other readers inconsistent. The migration removes timestamp equality and
aligns recipient-type checking with capture validation; all other coverage and
conflict guards remain.

There are no column changes or data UPDATE/DELETE statements, no rewritten
evidence, no economic writes and no recapture requirement. The integration
regression applies the old and new views to the **same** sealed five-version
fixture, observes 0/5 then 5/5, and compares complete versions/documents/lines
before and after. It also checks overview, inventory list and item flags.

Existing inventories may continue to have their original raw-data fingerprints;
those fingerprints are evidence of the original capture, not a migration target.
Capture gates remain an operational control and this change does not enable them.

## Validation scope

Regressions cover the five UUID/version shapes, 5 PDFs, 5 JSON files, 71 lines,
fractional cents, idempotency, same-version conflicts, newer versions at the same
timestamp, exact-microsecond freshness, invalid/missing timestamps, equivalent
offsets/trailing zeros, old-inventory retries, and UUID/version/recipient guards.
The existing archive suites cover concurrency, stale leases, interrupted resume,
scope isolation, immutable evidence and the posted Pilot baseline. Statements
Playwright uses microsecond source timestamps.

No live documents or credentials are committed. Local and CI validation use
disposable PostgreSQL/private storage; this PR does not deploy or capture live
statements.
