# QuickManage browser-assisted statement acquisition

This bridge uses the PR #80 archive, storage, parser, capture leases, immutable versions, conflict quarantine, and identity-based coverage. It creates no Accounting transactions, allocations, expectations, bank matches, Pilot events, Companies, or Trucks.

## Trust and authorization

QuickManage client credentials authenticate but receive 403 for the browser payroll resources. Do not retry with those credentials or copy browser credentials into FleetPilot. The local operator tool connects to an already authenticated **local** browser, reads only fixed QuickManage endpoints, and exports business evidence. It never contacts FleetPilot. Upload those files through the authenticated, same-origin FleetPilot Capture page.

Only the acquisition process temporarily holds source request headers. No cookies, credentials, CSRF secrets, browser storage, signed URLs, or source authorization headers are serialized into an export or FleetPilot request. Failures produce generic messages. The upload page rejects recognizable credential-bearing exports locally before making a request; the server repeats that guard. Catalog and inventory schemas allow only known business fields. Detail validation rejects transport/credential keys recursively and URLs, including inside source metadata.

**Assurance limit:** QuickManage does not sign these exports. A checksum proves integrity of submitted bytes, not their origin. FleetPilot independently verifies schema, bindings, actor authority, source identities, types, limits, money representation, checksums and consistency with its immutable inventory. It cannot prove that an authorized submitter has not fabricated mutually consistent business evidence or substituted a PDF. Company confirmation explicitly records `OWNER_ATTESTED_BROWSER_EVIDENCE`, not provider-authenticated proof. Completeness describes the submitted immutable manifest; it does not certify that the provider has no other statements. If cryptographic proof of provider origin is required, this bridge must remain disabled until a supported signed export/integration exists.

## Company and historical scope

1. An OWNER imports the browser Company catalog under a server-configured account namespace. FleetPilot validates and stores an immutable catalog checksum. Repeated identical catalog submissions are idempotent.
2. The review lists exact provider IDs/names/status/counts and supplied PID ranges; absent ranges are explicit. Name matches are suggestions only. Existing conflicting source-company provenance is AMBIGUOUS. There is no automatic binding.
3. An OWNER selects an existing canonical Company, describes authoritative identity evidence, and explicitly attests that both identities are the same Company. The server checks catalog membership, canonical OWNER membership, current group authority, configured account/group, existing binding conflicts and canonical scope.
4. A historical canonical Company outside operational Accounting requires the separate historical-scope checkbox. `ArchiveScopeGrant` records the OWNER and reason. It does **not** create an OperatingGroupCompany row. Companies belonging to another operational/archive group are rejected, even when the actor belongs to both.
5. Archive reads and uploads extend the actor's operational scope only with granted Companies for which the actor still has ADMIN/OWNER Company membership. Economics continue using the original operational authorization context. Removing membership removes archive access; evidence/grants themselves remain immutable.

The database enforces one account/provider-company binding and a composite FK to the explicit archive grant. Canonical Company locks serialize grant and operational-membership writes so those paths cannot race into different groups. Existing bindings migrate to grants without changing their identities. No automatic Company creation is supported. Historical provider Companies without canonical records remain blocked pending a separately reviewed strategy.

## Default-off configuration

These existing server settings must identify the reviewed provider account and Accounting security group:

- `QUICKMANAGE_ARCHIVE_ACCOUNT_KEY`: stable, operator-verified account namespace, never accepted from the browser.
- `QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID`: authorized group.
- `QUICKMANAGE_BROWSER_BRIDGE_ENABLED=true`: explicitly enables browser evidence ingestion; defaults false.

Keep `QUICKMANAGE_ARCHIVE_ENABLED=false`. The browser bridge never calls the server QuickManage client. Enabling the bridge is separate from authorizing a live sample. This development PR does not enable any Alpha flag, create any Alpha binding, deploy, acquire live evidence, or run a live sample/backfill.

## Local acquisition

Use the repository's installed Playwright/tsx tooling. Open a dedicated Chromium profile with its debugging endpoint bound to loopback, then sign in to QuickManage directly. Do not expose the debugging port to a network. The tool defaults to `http://127.0.0.1:9222` and refuses non-loopback CDP URLs. Do not send login information to FleetPilot or enter it into export arguments.

```bash
npx tsx scripts/quickmanage-browser-export.ts --mode companies --out /private/path/companies.json
npx tsx scripts/quickmanage-browser-export.ts --mode inventory --company PROVIDER_UUID --pid 2026-37 --out /private/path/inventory.json
npx tsx scripts/quickmanage-browser-export.ts --mode statement --company PROVIDER_UUID --pid 2026-37 --statement STATEMENT_UUID --out /private/path/statement.json
```

The output file must not already exist. New directories are private and exports use mode 0600. Exports contain sensitive business evidence; store them privately and remove them after archive verification according to retention policy. The tool never writes a standalone PDF or browser credentials and never overwrites an export. It closes only its own tab and disconnects from the browser.

Verified browser contracts reused from discovery/readiness:

- GET `/api/carriers` for Company identity.
- POST `/api/payroll/statements/stats` and `/api/payroll/statements?page=N` are **read-only queries**. Body: `carrier_id`, empty keyword/statuses/roles/tag_ids, `exclude_tags:null`, page, `contractor:null` (both recipient types).
- Inventory scans explicit Company pages (at most 80 × 250) twice, checks total count, unique UUIDs and Company isolation, then exports the selected PID only (at most 2,000 identities). The two selected manifests must agree. No inventory is uploaded automatically.
- GET `/api/payroll/{UUID}?carrier_id={CompanyUUID}` → GET `/api/payroll/{UUID}/download?carrier_id={CompanyUUID}` → re-read detail. Detail bytes must match before/after. HEAD is unsupported and is not used by acquisition.
- Real provider version is used, never derived from timestamps. The tool acquires the currently exposed version; retrieval of arbitrary superseded versions is not claimed.

No mutation endpoint, arbitrary URL, redirects, global all-company pagination, bulk-capture command or historical backfill command exists in the tool. Terminated recipients are included through All Statements; no active-person requirement is imposed. The earlier all-status Drivers/Contractors discovery remains a read-only way to locate historical recipients, but is not required to store a statement's provider identity.

## FleetPilot workflow and uploads

Accounting → Statements → Capture:

1. Open/authenticate QuickManage and export the Company catalog.
2. Upload catalog; review identities and OWNER-confirm eligible bindings.
3. Export and upload one Company/PID inventory; preview/resume its exact identities and coverage.
4. Export selected statements; preview at most ten files and explicitly capture the selected files.
5. Review immutable versions, recipient lifecycle, unresolved Trucks and completeness.

The server accepts one statement per request. The UI limits an explicit action to ten files and 56 MiB in aggregate, and sends them sequentially. There is no Capture All History control. Partial success remains committed; reopen the page and reupload the same inventory, or use its saved ID to load server progress. Failed items can be retried; already captured UUID/version/content can deliberately be submitted again for idempotency acceptance.

POST `/api/finance/archive/bridge` uses the existing authenticated Accounting session, a default-off gate, exact same-Origin validation, JSON content type and a streamed 56 MiB request limit. It accepts no multipart uploads, filenames, archive containers, remote fetch URLs or compressed files. No request payload is logged. PDF bytes are limited to 20 MiB, detail JSON to 10 MiB; base64 encoding, PDF MIME/signature/EOF and obvious active-content markers are validated. These checks are not a full PDF malware scanner; originals are served as private attachments rather than executed. Both SHA-256 hashes are recomputed server-side. Storage keys and display filenames are generated by existing archive storage, never client paths.

The submitted identity must match the scoped inventory UUID/version/PID/recipient/type and provider timestamp. The detail Company name must match the confirmed provider identity, and any detail carrier UUID must match the envelope. Raw original JSON/PDF bytes remain immutable. Known financial fields reject malformed and overflowing values. Exact cents normalize to integer minor units. Existing parser behavior preserves genuine fractional-cent source precision as a null normalized amount with a visible issue, never silently rounds or posts economics.

Database advisory locks, unique identity/version constraints and job leases serialize durable writes. Concurrent same-job uploads may return CAPTURING/retry; after completion, retries are idempotent. Identical duplicate capture emits a separate duplicate audit event, not a second capture-success event. Different same-version bytes are quarantined as NEEDS_REVIEW and cannot overwrite the original. New provider versions preserve old versions and require the existing source-change review flow. Inventory snapshots are immutable; retrying the latest identical manifest reuses it, while later changes—including returning to an older manifest—create a new snapshot.

Unknown, ambiguous or inactive Trucks do not block capture. Exact VIN/Company-unit mapping follows the existing archive resolver; conflicts remain NEEDS_REVIEW. Provider recipient identities persist independently of active FleetPilot people.

## Future live acceptance

Only after deployment/configuration is separately authorized, server-side OWNER bindings exist, historical eligibility is resolved and the exact sample is explicitly approved: capture five unique statements (active Driver, active Contractor, terminated Driver, terminated Contractor, fuel with multiple deductions), preferably across two Companies/PIDs. Repeat one unchanged UUID/version and verify no extra identity, version, PDF, JSON, normalized lines or economic records. Revalidate versions at execution. This PR performs synthetic acceptance only.

## Final security review clarifications

FleetPilot is authoritative for its active-user/session authorization, current Company/group memberships, server-selected account namespace, recorded OWNER confirmation, generated storage identities, recomputed checksums and immutable archive history. Provider Company UUID/name, recipient identity, version, timestamps, amounts, PDF contents, twice-read assertions and the number of provider statements are browser assertions. Cross-checking these assertions catches inconsistencies; it cannot authenticate a consistently fabricated export. No provider signature or independently accessible payroll UUID/version oracle was discovered.

Bindings display OWNER_CONFIRMED rather than provider verified. The server rejects a selected canonical Company's conflicting stored source Company ID, including historical Companies; an OWNER must resolve authoritative provenance before binding. A name match never grants scope. Historical grants require both current group authority and a current canonical Company ADMIN/OWNER membership for archive access; they confer no operational Accounting membership.

Every new version stores server-generated archiveProvenance in its sealed header; inventory metadata and inventory/conflict/capture audit events identify acquisition. The archive views explain that COMPLETE means complete against the captured inventory snapshot. A smaller fabricated snapshot can be complete against itself when omitted identities have never been captured; it cannot certify all provider history, replace the earlier snapshot, or conceal already archived unexpected identities.

Credential guards reject recognizable credential fields and URL/Bearer/JWT values before upload and on the server. This is not proof that arbitrary untrusted business text or binary PDF bytes contain no disguised secret. The supported exporter never serializes transport credentials. PDF checks reject obvious active content but are not full structural validation, malware scanning or content-to-statement authentication. Downloads use attachment disposition, no-store, nosniff and a sandbox CSP. No evidence value is used as a server fetch URL.


## Fixed-pay ordering comparison

The diagnosed Caribe v14 response has seven `data.fixed_pays` records whose array
order varies while complete day-keyed rows and the PDF remain identical. Acquisition
compares versioned business fingerprints (currently `quickmanage-fixed-pays-trip-ties-v2`), independently of
raw JSON SHA-256. The shared helper uses a bounded, lossless typed JSON tree: sorted
object keys, exact numeric lexemes and types, and unchanged order for every other
array. The fixed-pay rule sorts `data.fixed_pays` by `(Sunday=0 … Saturday=6, complete typed
canonical row serialization)`. The full row is a deterministic tie-breaker, including
unknown fields. Identical and same-day duplicate rows are retained; nothing is
summed, rounded, deduplicated, stripped or rewritten. Missing/invalid weekday
identities fail closed. Missing/null/empty fixed-pay collections retain their
original distinct representations.

New browser exports include `detailAfterBase64` and its exact `detailAfterSha256`.
The server guards both raw responses, checks the second raw checksum, and independently
recomputes their business fingerprints. A claimed fingerprint alone is never
accepted. Legacy exports without the second body still require exact raw equality.
Each JSON read is limited to 10 MiB and the PDF to 20 MiB; the bounded request/file
limit is 56 MiB to accommodate both base64 JSON bodies and the PDF. The first exact
raw response remains the selected immutable archive JSON, with its original raw
SHA-256; the second read is validation-only, not another archive version.

Same-UUID/version retries first verify existing stored PDF/JSON bytes against their
original raw checksums. Equal business fingerprint **and exact PDF checksum** reuse
the original immutable version, files and lines. The duplicate audit distinguishes
`archivedRawChecksum`, `observedRawChecksum`, and the versioned `businessFingerprint`.
The observed duplicate payload is not another successful capture and is not stored
as a duplicate JSON attachment. Repeated observations of an existing quarantined
conflict are likewise compared without duplicating conflict evidence.

True business changes and PDF-byte changes remain quarantined NEEDS_REVIEW;
ordering-equivalent retries do not clear an existing review state. A newer provider
version remains a separate immutable version. Canonical fingerprints are derived
from old raw attachments when needed: no schema change, migration, existing checksum
rewrite, or normalized-line rewrite. Completeness still uses exact provider
UUID/version/PID/recipient identity, not the business fingerprint. This comparison
is an internal control, not provider authentication; provenance is unchanged.


### Equal-time trip comparison (v2)

`quickmanage-fixed-pays-trip-ties-v2` retains the fixed-pay rule and normalizes
only contiguous `data.trips` runs whose `origin_app_time` values resolve to the
same instant using `providerInstant`. That parser preserves every fractional
second digit; no rounding or time bucketing occurs. Original timestamp strings
still participate in the fingerprint, so changing their representation remains
a detectable source change even when they denote the same instant.

Within each run the sort key is identity kind rank (`trip_id`, then
`trip_ref_number`, then `id`), the first nonempty string identity available, then
the complete typed canonical row. Comparisons use deterministic code-unit order.
Missing/invalid times and absent usable identities are barriers: they retain
source order and never authorize equivalence. Equal times separated by another
group are not collected together. Distinct-time group order, nested
`statement_stops`, and every other array remain significant.

Every row, including identical rows and repeated IDs, is retained. No values are
summed, rounded, dropped or rewritten. Raw JSON/PDF bytes and checksums retain
their existing contracts; only the internal comparison representation changes.
Existing evidence is hash-verified and compared at read time under v2; old audit
fingerprints remain immutable with their recorded version. No migration,
recapture, completeness-identity or provider-version change is required.

The v8 regression models 27 trips and all seven observed response orders (four
unique variants), with two equal-time pairs. Unknown provider ordering behavior
outside this rule remains fail-closed; this does not declare trips globally
unordered.
