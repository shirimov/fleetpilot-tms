# Pilot Fuel Import and Three-Way Reconciliation Design

Status: architecture/discovery only. This document does not authorize a Pilot adapter, schema migration, financial write, category creation, bank import, settlement import, or production deployment.

## 1. Objective and control boundary

FleetPilot needs to control one economic fuel expense through three independently sourced facts:

1. Pilot says which products were purchased, for how much, and for which truck unit.
2. A bank source says how much cash Pilot collected.
3. A truck or owner settlement says how much of the original expense was recovered through a deduction.

These facts corroborate one another, but they are not three operating expenses. The Pilot invoice is the economic expense. The bank payment is cash settlement of that expense. An owner/truck settlement deduction is recovery or chargeback against that expense. Reports must count the Pilot expense once.

All records remain inside an explicit `OperatingGroup`. The active server-authorized operating-group context is authoritative; clients never provide or select an authoritative group identifier. OWNER and authorized ADMIN may operate imports. MEMBER remains denied Accounting.

## 2. Existing Accounting architecture

The current foundation already provides most of the control primitives:

- `FinancialSource` represents a bank account, fuel card, settlement source, or other financial source. It may be associated with one company, but its operating group is the authorization boundary.
- `FinancialStatement` is a privately stored physical source document with period, SHA-256 checksum, source, import state, control totals, and importer attribution. File checksum uniqueness currently prevents an identical physical file from being registered twice in one operating group.
- `FinancialImportRecord` preserves each raw source row separately from any canonical transaction. It stores raw values, provider metadata, normalized candidates, a row fingerprint, and review state.
- `FinancialTransaction` is the canonical economic/control transaction. Money is positive `BigInt` minor units with explicit direction and currency.
- `FinancialTransactionEvidence` links raw rows to transactions as `PRIMARY` or `CORROBORATING`, with exact matched minor units and restrictive foreign keys.
- `FinancialAllocation` splits a transaction across category and canonical operational dimensions, including Company, Truck, Trailer, Driver, Employee, Load, Customer, FinancialParty, and Program.
- `FinancialExpectation` represents expected money independently from observed transactions and supports partial matching through `FinancialExpectationMatch`.
- owner recovery fields currently operate at whole-transaction granularity.
- `FinancialAuditEvent` records material actions with actor, operating group, optional company/transaction, safe metadata, and timestamp.
- evidence and expectation matching use deterministic PostgreSQL transaction advisory locks and exact aggregate caps.
- completeness and reconciliation distinguish statements, raw rows, matched evidence, allocations, and fully reconciled transactions.
- `FinancialControlAuthorizationService.requireContext()` requires active company membership, an explicit operating-group membership, and ADMIN by default. It derives all company IDs from the group on the server.

### Gaps relevant to Pilot

The generic foundation intentionally does not yet model:

- one provider invoice represented by multiple physical documents, such as XLS plus PDF;
- provider/invoice natural-key uniqueness independent of filename and file checksum;
- a typed Pilot line interpretation with unit, card, ticket, authorization, product, gallons, price, retail, and savings fields;
- multiple simultaneous review issues on a row;
- traceability from a posted allocation back to the exact provider line;
- the accounting role that distinguishes an economic expense from a later cash settlement or recovery;
- recovery expectations at allocation/truck/owner granularity;
- reviewed bank-payment candidates that may be ambiguous, underpaid, or overpaid.

Those gaps should be filled in later migrations. They should not be hidden in category names or mutable JSON-only workflow state.

## 3. Known Pilot source format

The supplied discovery inventory covers consecutive weekly Marybeg LLC Direct Billing invoices:

| Invoice | Billing date | Period |
| --- | --- | --- |
| 787303394 | 2026-07-06 | 2026-06-29 through 2026-07-05 |
| 788363801 | 2026-07-13 | 2026-07-06 through 2026-07-12 |
| 789500735 | 2026-07-20 | 2026-07-13 through 2026-07-19 |
| 790734384 | 2026-07-27 | 2026-07-20 through 2026-07-26 |
| 791805751 | 2026-08-03 | 2026-07-27 through 2026-08-02 |

Known detailed fields include card number, unit number, location number, city, state, ticket number, authorization number, optional PO number, transaction date, odometer, product code, units/gallons, cost per gallon, transaction amount, invoice total, retail total, savings, and driver/name context.

Observed product codes include `020`, `033`, and `140`. This document deliberately assigns no meaning to those codes. Meanings must be verified against representative XLS rows, corresponding invoice presentation, and Pilot documentation or stable source behavior before a mapping becomes active.

The actual workbooks/PDFs were not committed as fixtures in this sprint. Column names, merged headers, summary rows, credit conventions, precision, and event grouping therefore remain discovery questions, not implementation assumptions.

## 4. Recommended canonical model

### 4.1 Invoice aggregate

Introduce a future provider-invoice/import aggregate representing one Pilot invoice independent of its physical files. A working name is `FinancialProviderInvoice`; naming should be finalized with the first migration.

Minimum fields:

- `id`, `operatingGroupId`, `sourceId`;
- `provider` (`PILOT` initially) and normalized provider account reference;
- invoice number, billing date, due date when present, period start/end;
- currency, invoice total minor units, parsed detail total minor units, signed difference minor units;
- parse version and lifecycle status;
- created/confirmed actor and timestamps;
- posted canonical transaction ID when posting succeeds;
- immutable idempotency key and provider-natural-key hash.

Recommended uniqueness is operating group + provider + normalized provider account + invoice number. Period and amount participate in conflict detection but should not replace the invoice number when a trustworthy invoice number exists.

### 4.2 Physical documents

Keep `FinancialStatement` as the physical private document. Add a future join from the invoice aggregate to one or more statements with a document role:

- `STRUCTURED_SOURCE`: preferred XLS/XLSX used to parse detailed rows;
- `DOCUMENTARY`: PDF invoice retained for human review;
- `SUPPLEMENTAL`: a corrected or supporting provider file, explicitly reviewed.

The join must be unique per invoice/document and must not create economics. XLS and PDF for invoice `787303394` belong to the same provider invoice even though their file hashes differ.

The current validator accepts `.xlsx`, not legacy `.xls`. The real Pilot export extension and binary format must be verified. Supporting legacy XLS would require a deliberately selected, bounded spreadsheet parser and signature validation; renaming an XLS file to XLSX is not acceptable.

### 4.3 Raw and typed line layers

`FinancialImportRecord` remains the immutable raw-row record. Preserve every source value in `rawMetadata`, including rows that cannot be interpreted.

Add a future one-to-one typed interpretation, tentatively `PilotFuelLine`, linked to its `FinancialImportRecord` and provider invoice. Suggested fields include:

- provider row/event natural key and parser version;
- normalized card, source unit number, location, ticket, authorization, and PO;
- source driver/name context;
- source transaction date/time and odometer;
- product code and unmodified product description, if present;
- raw quantity and price plus exact decimal normalized quantity/price;
- transaction amount, retail amount, and savings in integer minor units;
- matched canonical `truckId`, optional reviewed `trailerId`, and match provenance;
- proposed category ID and mapping-version reference;
- posting state and posted allocation ID.

Quantity and unit price must not use JavaScript binary floating point. Use bounded Prisma `Decimal` columns or scaled integers after source precision is measured. Authoritative monetary totals remain `BigInt` minor units. Raw strings are retained regardless of parse success.

### 4.4 Canonical transaction granularity

Recommendation: create **one canonical `FinancialTransaction` for the Pilot invoice**, and create one traceable `FinancialAllocation` per accepted economic product line (aggregation is a later reporting optimization, not the import truth).

Reasons:

- the invoice is one payable/economic obligation with one exact control total;
- the existing architecture already supports one statement transaction allocated across many units and categories;
- diesel, DEF, reefer fuel, credits, and unknown products remain individually inspectable in raw/typed lines and allocations;
- the bank payment naturally settles one invoice total;
- a retry has one invoice-level posting boundary;
- thirty trucks do not require thirty unrelated top-level invoice transactions.

Add a future nullable `sourceImportRecordId` (or provider-line ID) to `FinancialAllocation`, with a uniqueness rule preventing the same accepted Pilot line from posting twice. The allocation amount and category describe the economic line; truck and other dimensions describe attribution.

Alternative A, one transaction per product line, makes product details direct transactions but creates a many-to-one payable/payment problem and a much larger idempotency surface. Alternative B, one transaction per fueling event with new child detail rows, is semantically strong but duplicates much of the invoice + raw-line + allocation structure. The recommended invoice transaction plus line-linked allocations fits the current foundation with fewer competing concepts.

If representative data proves that one XLS row is only a component of a single amount-bearing event rather than an independently amount-bearing product line, the parser must group those rows into one typed economic line before preview. It must never post both the event total and its components.

## 5. Truck matching

The only automatic primary truck key is the Pilot source unit number.

Normalization may remove source formatting that is demonstrably non-semantic, such as surrounding whitespace and a documented consistent case convention. It must not strip leading zeroes, punctuation, prefixes, or other characters until samples prove equivalence. Preserve both raw and normalized values.

Matching algorithm:

1. Find canonical Trucks whose `companyId` belongs to the authorized operating group.
2. Compare the normalized Pilot unit number with the normalized canonical `Truck.unitNumber` using an exact comparison.
3. Exactly one match: set the proposed `truckId` and record `EXACT_UNIT` provenance.
4. No match: preserve the row and add `UNMATCHED_TRUCK`.
5. More than one match across group companies: add `AMBIGUOUS_TRUCK`; do not select one.

No Truck is created automatically. Driver name, current driver assignment, Team data, and card number are contextual fields and cannot choose a truck. A reviewer may explicitly resolve an unmatched/ambiguous row to an in-group truck, and the resolution must be audited.

The current database does not enforce operating-group-wide uniqueness of `Truck.unitNumber`; ambiguity handling is therefore required even if current Alpha data happens to be unique.

## 6. Product categorization

Provider product mapping answers accounting purpose; it does not create equipment dimensions. A future operating-group-scoped, versioned mapping should map:

`provider + provider account (optional) + product code -> active FinancialCategory`

A likely category tree is:

- Direct Expense
  - Fuel
    - Tractor Diesel
    - DEF
    - Reefer Fuel
    - Other Fuel / Review

No category or product mapping is created in this sprint. Codes `020`, `033`, and `140` remain unknown until verified.

An unknown/unsupported product:

- remains a raw and typed row;
- remains included in parsed row totals and invoice reconciliation;
- receives `UNKNOWN_PRODUCT`;
- cannot be silently assigned to a known fuel category;
- blocks automatic posting until an authorized reviewer selects a valid category or an approved mapping version resolves it.

Credits/returns must be modeled from verified source signs. Because current transaction/allocation money is positive with direction on the transaction, mixed positive/negative line behavior may require either signed allocation amounts or an explicit credit-line representation. This must be decided from real samples before migration.

## 7. Reefer handling

Reefer product data is never discarded. When the source unit matches a canonical Truck, allocate the line to that Truck. Leave `trailerId` null unless independent evidence supports an exact trailer.

The raw Pilot line remains immutable. Later enrichment may add a reviewed trailer dimension or a separate enrichment/audit record; it must not rewrite the source unit, product, or original raw metadata. Historical operational assignment is preferable to current trailer assignment, because current assignment can be wrong for an earlier invoice date.

## 8. Driver and source context

Preserve driver/name, card, unit, station/location, city/state, date/time, odometer, product, quantity, price, amount, retail amount, savings, invoice number, and period as provider attributes.

Do not create or link User, Employee, or Driver from statement text. A future driver matcher must be independent from truck attribution, scoped to the operating group, confidence-scored, reviewable, and safe when drivers change trucks.

Card number storage and display require a security decision. Prefer a provider token or masked/last-four value for normalized searchable fields while retaining the original only in protected raw evidence if operationally necessary. Never emit full card values into logs, audit metadata, URLs, or client analytics.

## 9. Exact invoice reconciliation

For a parsed invoice:

```text
parsedDetailTotalMinor = sum(all amount-bearing Pilot economic lines)
differenceMinor = parsedDetailTotalMinor - invoiceTotalMinor
```

Use exact integer minor units. There is no tolerance and no silent rounding.

- `differenceMinor == 0`: the invoice detail control is exact, subject to all row review issues being resolved.
- otherwise: add invoice-level `AMOUNT_MISMATCH` and require review.

Invalid, unknown-product, duplicate-suspected, and unmatched-truck rows remain in the control sum when they contain a valid authoritative amount. A malformed monetary row cannot be assigned zero; it receives `INVALID_ROW`, and the preview must state that the detail total is incomplete/unreliable.

Summary rows must be classified explicitly as controls or economics. Invoice total, subtotal, retail total, and savings summaries must not be counted as additional product expenses. Taxes, fees, credits, and adjustments that are real invoice economics must remain separate typed lines so the detail sum still reconciles.

An invoice can be `READY` only when:

- invoice identity and total are trustworthy;
- detail amount is complete and differs by zero;
- no unresolved invalid or duplicate row exists;
- every economic line has an approved category;
- every line requiring direct truck attribution has an exact/reviewed in-group Truck;
- currency is consistent;
- no already-posted provider natural key exists.

## 10. Review queue

A row can have multiple issues, so do not overload one enum with a single reason. Introduce a future generic `FinancialImportIssue` (or equivalent) linked to invoice and optionally raw row, with issue code, severity, details safe for the UI, resolution, resolver, and timestamps.

Issue codes should include:

- `UNMATCHED_TRUCK`
- `AMBIGUOUS_TRUCK`
- `UNKNOWN_PRODUCT`
- `DUPLICATE_ROW`
- `POSSIBLE_DUPLICATE_INVOICE`
- `AMOUNT_MISMATCH`
- `INVALID_ROW`
- `UNSUPPORTED_CREDIT`
- `MISSING_INVOICE_IDENTITY`

Aggregate preview states:

- `PARSING`
- `NEEDS_REVIEW`
- `READY`
- `POSTING`
- `POSTED`
- `FAILED`
- `SUPERSEDED` (only through an explicit reviewed correction workflow)

Raw rows are evidence, typed lines are parser interpretations, and posted transactions/allocations are canonical financial state. UI and APIs must never collapse these three layers.

## 11. Duplicate and overlap protection

Use multiple independent protections:

1. **Physical file:** existing operating-group + SHA-256 uniqueness rejects the same bytes under another filename.
2. **Invoice:** unique provider natural key from provider, normalized account, and invoice number prevents PDF and XLS from becoming separate invoices. Period, billing date, currency, and total detect conflicting reissues.
3. **Line:** hash normalized provider identity plus card/token, ticket, authorization, unit, transaction timestamp/date, product, exact quantity, exact amount, and stable location/reference fields. Do not depend on filename or row index.
4. **Event:** where multiple product lines share a purchase event, derive an event key from stable Pilot identifiers such as account/card + ticket/authorization + date/time + location + unit. Product belongs in the line key, not necessarily the event key.
5. **Posting:** unique invoice-to-canonical-transaction and line-to-allocation relations make confirmation idempotent.
6. **Overlap:** compare line hashes across prior invoices/reports in the same provider account and overlapping periods. Preserve duplicates for review; never silently discard their amounts.

Conflicting files for the same invoice natural key should attach as supplemental evidence and set `NEEDS_REVIEW`; they must not overwrite the previously stored file or economics.

## 12. XLS and PDF relationship

- XLS/XLSX is the preferred structured source after its actual format and columns are verified.
- PDF is documentary/corroborating evidence for invoice identity, period, and total.
- Both attach to one provider invoice aggregate.
- Only one accepted structured parse version supplies posted typed lines.
- A PDF parser, if added later, may extract control candidates but cannot create a second expense when structured rows already represent the invoice.
- Every physical file retains its own checksum, private storage key, uploader, MIME/signature validation, and audit history.

## 13. Preview workflow and UI

Future navigation:

`Accounting -> Statements -> Upload Statement -> Provider: Pilot -> Parse -> Import Preview`

Upload accepts the structured file and an optional corresponding PDF. It stores documents and creates only raw/preview records; it does not create canonical financial transactions.

The preview shows:

- provider and source account;
- invoice number, billing/due dates, and period;
- invoice total, parsed detail total, and signed difference;
- row/event count;
- exact, unmatched, and ambiguous truck counts;
- unknown products and invalid rows;
- duplicate rows and possible duplicate invoice/file conflicts;
- currency and parse version;
- overall readiness state;
- a row table with source context, proposed category/truck, issues, and resolution history.

Filters should include all issue types, product code, source unit, matched Truck, and posting state. Reviewers can explicitly choose an in-group Truck/category, but cannot edit the immutable raw source values.

The Confirm/Post action is disabled until blocking issues are resolved and totals are exact. It displays the number and amount of transactions/allocations to be created and requires an authorized confirmation.

## 14. Posting lifecycle and idempotency

Confirmation must execute in one database transaction under a deterministic provider-invoice advisory lock:

1. reload the invoice, documents, raw rows, typed lines, mappings, and review issues in the authorized operating group;
2. verify `READY`, exact total, active categories, in-group dimensions, and no existing posted transaction;
3. create one DRAFT or POSTED invoice-level OUTFLOW `FinancialTransaction` according to the approved review policy;
4. link primary line evidence with exact minor units;
5. create line-linked allocations with category, Truck, optional company/owner/program, and null trailer unless reviewed evidence exists;
6. verify evidence and allocation totals equal the invoice total;
7. create the invoice-level bank-payment expectation;
8. create group-level and transaction audit events with parser/mapping versions and safe identifiers;
9. atomically mark the provider invoice POSTED and store its canonical transaction ID.

Retry with the same idempotency key returns the prior successful result. Database uniqueness on provider invoice, posted transaction, raw-line natural key, and source-line allocation is authoritative. A partial failure rolls back all canonical writes; private source documents and preview records remain for retry/review.

## 15. Bank-payment reconciliation

On confirmed Pilot posting, create one `FinancialExpectation` for an OUTFLOW equal to the invoice total, referencing Pilot as a vendor `FinancialParty`, invoice number, expected date window, currency, and optional expected paying source. This expectation is not an expense and does not affect operating totals.

A future bank adapter imports the actual debit as its own raw evidence and canonical cash transaction. Exact amount is the strongest signal, combined with:

- normalized Pilot/vendor terms and invoice/reference in description;
- expected source account;
- currency;
- posted/transaction date within a configurable reviewed window around billing/due date;
- provider account/reference where available;
- absence of another confirmed match.

Candidate states:

- `MATCHED`: one confirmed candidate and payment total equals invoice expectation;
- `PARTIAL`: confirmed payments total less than expected and further payment is plausible;
- `UNMATCHED`: no viable candidate;
- `AMBIGUOUS`: multiple viable candidates require review;
- `UNDERPAID`: payment appears final but total is below expectation;
- `OVERPAID`: candidate payment total exceeds expectation.

The current expectation match prevents over-matching and has no candidate/ambiguous/overpaid representation. Add a future reviewed match-candidate layer or extend expectation matching before bank import. Do not weaken exact caps merely to record an overpayment; preserve the candidate debit and expose the signed difference for review.

## 16. Non-double-counting model

Future canonical transactions need an explicit accounting/control role, for example:

- `ECONOMIC`: affects operating income/expense (the Pilot invoice transaction);
- `CASH_SETTLEMENT`: movement that settles an economic obligation (the bank debit);
- `RECOVERY`: owner/truck chargeback or settlement deduction against an expense;
- existing `TRANSFER`: internal cash movement.

This role must be explicit data, not inferred from category, description, source type, or sign. Operating expense totals include only `ECONOMIC` outflows. Cash controls include `CASH_SETTLEMENT`; recovery reports include `RECOVERY`. Linking/matching explains how they settle the economic transaction without counting them as additional fuel expense.

Until that role exists, do not post both Pilot expense and bank debit into current operating totals. This is a schema/design blocker for a production bank adapter, not for preview parsing.

## 17. Truck/owner settlement reconciliation

For every posted Pilot allocation attributable to a recoverable owner/truck, create a future recovery obligation linked to that exact allocation:

- source allocation and invoice;
- truck and optional OWNER_OPERATOR `FinancialParty`;
- expected recovery minor units;
- recovered/waived minor units and status;
- effective settlement period;
- immutable match and audit history.

The current recovery fields are transaction-wide and cannot safely represent a multi-truck invoice. Extend recovery to allocation-level obligations or add a dedicated `FinancialRecoveryExpectation`; do not duplicate owner recovery fields independently on provider rows.

A future settlement importer preserves each deduction as raw evidence and a `RECOVERY` control transaction/record, then matches deductions to obligations by exact Truck first, owner where authoritative, date/settlement period, category/type, and exact amount.

For Truck 6010:

```text
expected = sum(posted Pilot allocations recoverable from Truck/Owner 6010)
deducted = sum(confirmed settlement-deduction matches)
difference = deducted - expected
```

- zero: `MATCHED`;
- negative: `UNDER_DEDUCTED` by the absolute difference;
- positive: `OVER_DEDUCTED` by the difference;
- multiple plausible deductions: `AMBIGUOUS`;
- no deduction after the expected settlement window: `UNMATCHED`.

The deduction reduces owner/truck payable or records recovery; it never creates another Fuel expense. Waiver remains an explicit authorized audited action.

## 18. Company and operating-group attribution

The Pilot account name or paying bank account does not dictate the expense company. The operating group is the control boundary. A line's exact canonical Truck supplies its operational company dimension when appropriate; general fees may remain group overhead or require explicit company review.

Cross-group Trucks, parties, sources, categories, and programs are rejected server-side. A bank account owned by one company may settle an invoice allocated to Trucks across group companies without rewriting those allocation companies. This is management Accounting, not tax/legal-entity accounting.

## 19. Proposed schema changes (future only)

No schema was changed in this sprint. A later reviewed migration will likely need:

1. provider invoice/import aggregate with natural-key uniqueness, exact totals, parse version, status, and posted transaction relation;
2. invoice-to-`FinancialStatement` join with structured/documentary/supplemental role;
3. typed `PilotFuelLine` linked one-to-one with `FinancialImportRecord`;
4. multi-issue import review records with audited resolution;
5. provider product mapping with version/effective state and category relation;
6. traceable `FinancialAllocation.sourceImportRecordId` or typed-line relation and uniqueness;
7. explicit `FinancialTransaction` accounting/control role to separate economics, cash settlement, and recovery;
8. reviewed expectation/payment candidate support for ambiguity and over/under payment;
9. allocation-level recovery obligation and settlement-deduction matches;
10. indexes on operating group + provider identity, invoice natural key, line/event hash, issue state, unit, product, posted relation, and match state.

All new relations should use restrictive deletion for financial history. Raw documents/rows remain immutable. Provider natural keys and posting uniqueness must be database-enforced, not application-only.

## 20. Proposed APIs (future only)

All endpoints require server-derived `FinancialAuthorization`; no request accepts authoritative operating-group/company identity.

- `POST /api/finance/imports/pilot/previews` — multipart structured file plus optional PDF and source ID; store, parse, and return preview only.
- `GET /api/finance/imports/{invoiceImportId}` — invoice controls, files, totals, issues, and posting state.
- `GET /api/finance/imports/{invoiceImportId}/rows` — paginated raw/typed lines and review issues.
- `PATCH /api/finance/imports/{invoiceImportId}/rows/{lineId}/resolution` — explicit in-group Truck/category/trailer resolution with optimistic version and audit.
- `POST /api/finance/imports/{invoiceImportId}/reparse` — authorized versioned reparse; never overwrite a posted interpretation.
- `POST /api/finance/imports/{invoiceImportId}/confirm` — idempotent transactional posting.
- `GET /api/finance/imports/{invoiceImportId}/duplicates` — candidate invoice/line conflicts.
- future `GET/POST /api/finance/payment-matches/...` — reviewed bank candidates and confirmation.
- future `GET/POST /api/finance/recovery-matches/...` — settlement deduction candidates and confirmation.

Upload/parse should be bounded by file size, row count, decompressed workbook size, sheet count, cell count, and execution timeout. Spreadsheet formulas/macros/external links are treated as data or rejected; they are never executed.

## 21. Proposed service boundaries

- `FinancialDocumentService`: validation, private storage, checksums, document attachment, and download authorization.
- `PilotInvoiceParser`: pure bytes-to-candidate parse with no database or network writes.
- `PilotInvoiceNormalizer`: typed exact values, event/line keys, and control-row classification.
- `PilotTruckMatcher`: exact unit matching within the authorized group.
- `FinancialProductMappingService`: versioned provider-code-to-category proposals.
- `FinancialImportReviewService`: issues, explicit resolutions, readiness, and preview projections.
- `PilotInvoicePostingService`: locked, idempotent canonical transaction/evidence/allocation posting.
- `InvoiceControlService`: detail-to-invoice exact reconciliation.
- `PaymentReconciliationService`: expectation and reviewed bank-payment matching.
- `RecoveryReconciliationService`: allocation-level owner/truck obligations and settlement deductions.

Parsing and matching produce proposals. Only the posting/reconciliation services perform authorized canonical writes.

## 22. Test strategy

Use synthetic/redacted fixtures derived from representative source structures; never commit real card numbers, personal details, or unredacted invoices.

Parser tests:

- all observed headers/layouts and five consecutive invoice periods;
- product, event, total, fee, credit, and summary-row classification;
- exact quantity/price/money parsing and calendar dates;
- malformed workbook, formula, external link, oversized/zip-bomb, invalid MIME/signature, and row/cell limits;
- codes `020`, `033`, and `140` remain unknown until an approved fixture proves mapping.

Control tests:

- detail sum equals invoice exactly and one-cent mismatch fails;
- invalid/unknown/unmatched rows remain in totals;
- PDF + XLS attach to one invoice and cannot create two expenses;
- same bytes/different name, same invoice/different bytes, repeated row, overlapping report, and corrected-file conflicts;
- exact unit match, leading-zero preservation, no match, ambiguity, cross-group denial, and no automatic Truck/Driver creation;
- reefer line retains Truck and null Trailer without evidence;
- preview makes zero canonical writes;
- confirm is atomic and idempotent under retries/concurrency;
- evidence and allocations equal the invoice total exactly;
- OWNER/ADMIN policy and MEMBER denial;
- audit actor, parse/mapping version, and safe metadata.

Future reconciliation tests:

- exact, partial, ambiguous, underpaid, overpaid, and unmatched bank payment;
- many payments to one invoice where supported;
- Pilot expense counted once when bank settlement is linked;
- exact, under-, over-, ambiguous, and missing owner/truck deductions;
- settlement deduction counted as recovery, never a second expense;
- concurrent payment/recovery matches cannot exceed authoritative caps.

Playwright should cover upload, preview, issue filters, explicit row resolution, blocked confirmation, exact ready state, idempotent confirmation, and read-only evidence download using mocked/redacted files. Real Pilot, bank, or settlement network calls are unnecessary.

## 23. Implementation phases

### Phase 0 — source verification

- obtain redacted XLS/XLSX and PDF pairs for the listed invoices;
- verify provider account identity, due date, headers, summary rows, product-code meanings, signs, precision, and purchase-event keys;
- document a redaction procedure and fixture license/retention policy.

### Phase 1 — preview-only Pilot adapter

- migration for invoice/document aggregate, typed lines, issues, and mappings;
- bounded parser and exact control totals;
- exact Truck proposals and product review;
- preview UI/API with no canonical posting.

### Phase 2 — reviewed posting

- product mappings and explicit row resolutions;
- line-to-allocation traceability;
- locked idempotent invoice-level transaction posting;
- payment expectation creation and complete audit trail.

### Phase 3 — bank payment control

- explicit transaction accounting role;
- bank adapter/raw evidence;
- candidate scoring and reviewed expectation matches;
- exact/partial/ambiguous/over/under payment reporting without double counting.

### Phase 4 — settlement recovery control

- allocation-level recovery obligations;
- settlement deduction importer and reviewed matching;
- Truck/Owner exact, under-, and over-deduction reporting.

### Phase 5 — controlled enrichment and reporting

- historically valid trailer/driver enrichment without raw-evidence mutation;
- fuel by Truck/Owner/product/equipment cohort;
- payment and recovery exception dashboards.

Profitability, tax accounting, QuickBooks, AI recommendations, and automatic corrective actions remain separate future scopes.

## 24. Open questions and blockers

The first implementation must not begin until representative redacted source pairs answer:

1. Is the structured file XLS, XLSX, CSV, or more than one format?
2. Which sheet/header row contains authoritative detail, and are there merged headers or repeated page headers?
3. Which rows are product economics versus subtotal/control/display rows?
4. Are invoice total, taxes, fees, credits, retail total, and savings represented in detail, and with what signs?
5. What decimal precision is used for gallons and price, and is the transaction amount authoritative when quantity × price differs after display rounding?
6. What do product codes `020`, `033`, and `140` mean in these actual invoices?
7. Which combination of ticket, authorization, card, timestamp, and location is stable enough for an event key?
8. Are unit numbers globally unique in the operating group, and are leading zeroes meaningful?
9. Does the PDF state a due date and provider account identifier usable for payment matching?
10. Can Pilot reissue an invoice number with corrected detail, and how is revision identified?
11. Are company-owned Truck expenses ever charged back, or only owner-operator expenses?
12. What settlement row fields identify invoice/week, Truck, Owner, and deduction type?

These are discovery blockers for a production Pilot parser and mapping—not blockers to reviewing this architecture document.
