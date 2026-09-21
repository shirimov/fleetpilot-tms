# Truck operating-Company history

One physical Truck keeps its ID and globally unique normalized VIN across Company changes. `Truck.companyId` is the current operational Company; unit uniqueness remains current-Company scoped. Legal ownership, contractor responsibility and fuel discount policy are separate and are not fields in this model.

## Discovery

Read-only Internal Alpha discovery examined all 59 canonical Trucks and 1,689 sealed statements (19,323 normalized lines). No normalized raw VIN duplicates were found. Explicit statement VINs occur under multiple Companies for 28 VINs; 27 have one exact canonical match, one lacks a canonical master. All five archived Companies participate. No source-unit change was observed within this multi-Company subset; future changes remain possible. Statement rows without VIN were not promoted to physical identity through unit-only matching.

Rana's 12 statements pair six Driver VIN observations with six Contractor unit-only observations for September 6–12. Each physical VIN already belongs to a Turner canonical Truck. Earlier Turner and, for some Trucks, other Company statements are historical observations, not proof of transfer boundaries. The private discovery artifact contains exact VINs, canonical IDs, source statement/version IDs, Company-specific observed ranges/counts, units and Pilot counts. Do not commit raw business evidence or card/recipient data.

QuickManage lifecycle provenance contains import observations and Truck/provider IDs. Truck 8558 has status-history dates, not operating-Company history; its known conflicting source Company metadata must not override verified 1-9 attribution. No authoritative Company transition timestamp was found in stored provenance. Live provider sync is not part of this implementation.

**Historical backfill proposal: zero confirmed periods.** All 28 multi-Company cases need OWNER review of exact dates, including the missing-master case. September 6 is only a Rana transition hypothesis. No historical/current affiliations are created by migration, and no live Truck is moved. The separate private discovery/backfill report lists exact evidence for later explicit OWNER approval.

## Model and dates

`TruckCompanyAffiliation` holds confirmed `[effectiveFrom, effectiveTo)` calendar-date intervals, ending with exactly one current open interval once tracking is enabled. PostgreSQL DATE matches Pilot's purchase precision; QuickManage timestamps/work-period calendar labels remain source evidence. Callers must pass YYYY-MM-DD labels explicitly; the resolver does not silently convert timestamps or timezones. A Sunday–Saturday statement uses Sunday through following Sunday exclusive. Intraday transfers cannot be represented faithfully and require review, not a guessed day.

Untracked Trucks have no intervals. The migration does not manufacture an unknown start or use Truck creation/migration time. An authorized user must supply an evidenced start date to enable tracking. Gaps remain UNKNOWN. Future-dated moves are rejected because the operational Company must agree with the currently effective open interval; scheduled transfer execution is a separate future workflow.

`TruckCompanyHistoryRevision` is an append-only decision/evidence envelope: actor, action, source, source reference, reason, VIN snapshot, timestamp and prior revision. Affiliation rows are immutable except for one-way supersession. A reviewed correction appends a replacement timeline with a new revision and supersedes prior rows; original periods remain addressable through their revision. Manual confirmation and provider-history references have purpose-specific source values; neither constitutes automatic provider authentication. Unconfirmed observations stay in immutable archive/equipment evidence and the discovery report, not in the confirmed resolver table. No redundant observation store or numeric confidence score is introduced.

## Invariants and service

- A GiST exclusion constraint prevents overlapping active ranges per physical Truck. A partial unique index prevents two open periods, including concurrent writers.
- Deferred constraint triggers require one open interval matching `Truck.companyId` after every tracked Truck/timeline mutation; initial revisions cannot commit without a valid timeline. Affiliation parent Truck and revision must agree.
- Raw-field normalized VIN and current unit expression indexes close legacy null-normalized-field uniqueness bypasses. Migration fails on duplicates rather than merging, renumbering or changing IDs. Tracked VIN edits are blocked pending a separate identity-correction workflow.
- Movement locks the canonical Truck row, rechecks current memberships and expected revision, closes the prior range and opens the destination range, updates current Company, then records a lifecycle audit in one transaction. No Truck insert or financial/archive mutation occurs. A→B→A is valid. Destination unit conflicts fail closed, including concurrent collisions through database uniqueness.
- Legacy settlements/inspections currently authorize through today's Truck Company. Movement therefore fails closed when those dependencies or Driver assignments exist, until a reviewed dependency transfer/snapshot workflow is available. It does not silently reassign their historical visibility. Posted Pilot allocations and sealed archive evidence remain independent, immutable source attribution.
- History initialization requires its open Company to match current Company. Corrections must include one current open period and authorize every old and new Company. Source reference/reason are mandatory. Corrections retain all earlier revisions; no delete API exists.

`resolveTruckOperatingCompanyAt` returns EXACT, UNKNOWN or AMBIGUOUS. `resolveRange` additionally returns SPLIT_PERIOD for a fully covered Company transition within the requested range; coverage gaps return UNKNOWN. Overlapping invalid inputs return AMBIGUOUS even if Company IDs agree. There is no fallback to current Company, and INACTIVE Trucks remain resolvable.

`resolveStatementTruck` is a read-only future adapter: match physical VIN and resolve the entire authorized work range. A historical Company can resolve EXACT against a Truck now operating elsewhere. Different confirmed Company yields CONFLICT; gaps/splits remain review cases. It does not rewrite ArchiveTruck or recapture statements. Future Pilot attribution must use confirmed date resolution and block/review UNKNOWN or split data; existing posted Company allocations remain unchanged. This PR does not replace Pilot posting or build fuel reconciliation.

## Scope, UI and audit

The service rechecks active users and ADMIN/OWNER Company memberships. Ordinary MEMBER lacks Fleet/Accounting module access. Reads filter every interval to authorized Companies. Current unit/Company and evidence-reference text are withheld when current/full-history scope is not authorized. Hidden periods resolve UNKNOWN; foreign and nonexistent history resources return not found. Mutations require ADMIN/OWNER on current and all affected Companies; grouping Companies in Accounting does not confer membership authority. History does not grant access to other Companies' archived documents.

Truck list remains current operational Company. Clicking the unit opens Operating Company History with Company, inclusive start, exclusive end, source and CONFIRMED state. Authorized users can confirm an evidenced current start and move to another authorized Company. Failures retain the dialog/input; successful moves preserve physical identity. The standard Edit Truck Company selector is disabled because Company movement uses the audited workflow. Corrections use the authenticated revision-checked API, not an unrestricted edit/delete table.

`GET /api/trucks/:id/company-history` reads scoped current history; `?date=YYYY-MM-DD` and `?from=...&toExclusive=...` resolve historical attribution. `POST` accepts CONFIRM, MOVE or CORRECT, expectedRevisionId, source, sourceReference and reason. CONFIRM/CORRECT additionally supply the complete confirmed periods; MOVE supplies destinationCompanyId and effectiveDate. Clients must reload stale revisions. Unknown dates must never be fabricated to satisfy this API.

Later Accounting detail should show immutable posted/provider Company, separately resolved operating Company on the event/work date, and current operating Company labeled explicitly. No retrospective economic correction or fuel policy is implemented here.

## Migration and validation

The additive migration creates two tables, restrictive FKs, indexes and guards. It inserts no data and changes no existing Truck identity, operating Company, financial record or statement source. Extension `btree_gist` is required; runner/migrator validation checks it on PostgreSQL 17.5. Existing data must pass normalized VIN and Company/unit uniqueness before rollout.

Focused tests cover stable identity, A→B→A, immutable correction history, overlap/open guards, exact/unknown/ambiguous/split resolution, inactive Trucks, normalized VIN duplication, unit collision, authorization, concurrent stale-head moves, database consistency and the Rana/Turner same-VIN mapping pattern. Unit/integration regression, realistic upgrade preservation, UI, TypeScript/lint, build and Docker/Compose results are recorded in the task validation report. No Alpha migration, merge or deployment is authorized.
