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

The real structured files and matching PDFs were inspected read-only outside the repository. No source file, account/card value, authorization identifier, driver name, or transaction dump is committed. The findings below replace the earlier unverified assumptions.

### 3.1 Real Pilot Fixture Validation

#### Files and physical structure

The five structured sources are legacy BIFF/OLE **XLS**, not XLSX. Each has one sheet named `StatementEFS_US`, 20 columns, one merged metadata/header range, and no BIFF formula records. Workbook sizes grow with the weekly detail: 158, 178, 218, 263, and 286 rows. Values, including the final control total, are literal source values rather than calculated workbook formulas.

The row layout is stable across all five files:

1. row 1: account/provider label, invoice number, billing date, due date, and provider name;
2. rows 2-3: a two-row column header;
3. row 4 through the penultimate row: authoritative economic detail;
4. final row: `Total:` control row, which repeats aggregate quantities/amounts and must never become economics.

The 20 detail columns resolve to: Card Number, Unit Number, location code and city/state, Ticket Number, Authorization Number, PO/source driver context, transaction date, odometer, Product Code, Fuel Units, Fuel Cost, Fuel Amount, oil quantity/amount, cash advance, miscellaneous/discount, sales tax, Invoice Total, and Retail Total. There are no card subtotal rows, page headers, blank separator rows, or footer rows in the XLS sources. The matching PDFs are 32, 36, 45, 55, and 59 pages and contain card subtotals, invoice presentation, product-code legends, and the invoice total; those PDF summaries are documentary controls only.

The parser rule is therefore structural and strict: accept the metadata row and exact two-row header signature, parse every intervening row as economic detail (including an adjustment without a fuel product), and parse the single final `Total:` row only as the invoice control. A changed/missing signature is `INVALID_LAYOUT`; the parser must not guess a shifted column or silently skip a nonconforming row.

#### Authoritative types and precision

- Transaction dates are text `MM/DD` values with no time and no year. The year must be derived from the invoice period with explicit boundary logic, never the server clock. The five sources cover the expected weekly dates except one genuine `04/22` line carried on the 07/20 invoice; it must remain dated 04/22 and be flagged `OUT_OF_PERIOD`, not forced into the invoice week.
- Quantity cells are numeric and retain up to two decimal places in the underlying BIFF values even though the source display format is one decimal place.
- Unit-cost cells are numeric, displayed to four decimals, but underlying source values contain up to seven decimal places. Preserve the underlying exact decimal and the original display/raw value.
- Monetary cells use a two-decimal display and reconcile as exact cents. Authoritative money remains integer minor units. Gallons/quantity should use `Decimal(18,2)` and source price `Decimal(18,7)` (or equivalently scaled integers with scales 2 and 7); JavaScript `number` must not perform authoritative arithmetic.
- The transaction/invoice amount supplied by Pilot is authoritative. `quantity * source price` is an analytical check, not a replacement amount, because price display and line rounding differ.
- Odometer remains an optional raw exact value; future MPG must require validity/reliability review rather than assuming it is present or accurate.

#### Verified product mappings

Every corresponding PDF contains a provider product-code legend. The same mappings recur on all five invoices and align with repeated multi-line event patterns in the XLS sources:

| Pilot code | Verified provider description | Normalized type |
| --- | --- | --- |
| `020` | Truck Diesel | `TRACTOR_DIESEL` |
| `033` | Reefer | `REEFER_FUEL` |
| `140` | Diesel Exhaust Fluid | `DEF` |

The five structured files contain 674 code-020 lines, 103 code-033 lines, 305 code-140 lines, and one amount-bearing adjustment with no product code. This evidence is sufficient to seed a reviewed, versioned mapping for this provider/account in a later implementation. Any other code remains `UNKNOWN_PRODUCT` / `NEEDS_REVIEW`, retains its amount in reconciliation, and cannot be silently mapped.

#### Event grouping and natural keys

The 1,082 fuel product rows group into 698 fueling events, plus one invoice-level adjustment, for 1,083 amount-bearing detail rows. Of the fueling events, 323 contain multiple product lines and the largest contains three. Common combinations are `020 + 140`, `020 + 033 + 140`, and `020 + 033`. Within each multi-line event, card, unit, location, ticket, authorization, PO/source context, and transaction date are consistent; no inspected event repeats the same product code.

Within each invoice, `ticket + authorization` grouped all product components correctly and had no collision. The durable event natural key should nevertheless be scoped as:

`operating group + provider + normalized provider account + invoice number + ticket + authorization`

Card, unit, location, PO, and date are conflict-detection fields. They are not substitutes for provider identifiers. If ticket or authorization is missing, create a review-only fallback fingerprint from the complete preserved source tuple; do not claim provider identity or auto-post from a weak key.

The product-line natural key is `event natural key + source product code + source line fingerprint`. In these fixtures `event + product code` is unique, but the fingerprint/ordinal is retained defensively for future invoices that may repeat a product code in one ticket. Filename and row number are never identity.

The single 07/06 negative adjustment has no card/unit/auth/PO, zero quantity, a textual freight-rate correction reference, and `-28.59` in the discount/invoice amount. It is authoritative invoice economics but is not a fueling event or unknown fuel product. It becomes a typed invoice adjustment with its own economic transaction/control line. No other negative line, zero-amount line, fee, tax, non-fuel purchase, or unknown product code was observed. The out-of-period 04/22 truck-diesel line is retained and reviewable as late-billed economics.

#### Exact reconciliation results

For every invoice, summing each authoritative detail row's Invoice Total exactly, including the negative adjustment, equals the final XLS `Total:` and the matching PDF amount due. All five differences are exactly `0.00`. Retail totals and PDF/card subtotals are informational controls; they are never additional expenses. The files prove that summary-row ingestion would exactly double the expense and must be structurally prevented.

#### Relay evidence

The inspected Relay workbook is a separate operational export with `US` and `Summary by State` sheets. Its `US` sheet contains card, transaction number, location, product description, unit/vehicle context, quantity, and amount. It overlaps the same kinds of purchases but is not a Pilot payable source. Relay rows can later corroborate an event/product line using provider transaction, date/location, unit, product, quantity, and amount; the `Summary by State` sheet is never economic detail. A Relay-only row that appears missing from Pilot becomes a review candidate, not an automatic expense.

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
- posted event/adjustment transaction count and aggregate posting state;
- immutable idempotency key and provider-natural-key hash.

Recommended uniqueness is operating group + provider + normalized provider account + invoice number. Period and amount participate in conflict detection but should not replace the invoice number when a trustworthy invoice number exists.

### 4.2 Physical documents

Keep `FinancialStatement` as the physical private document. Add a future join from the invoice aggregate to one or more statements with a document role:

- `STRUCTURED_SOURCE`: preferred XLS/XLSX used to parse detailed rows;
- `DOCUMENTARY`: PDF invoice retained for human review;
- `SUPPLEMENTAL`: a corrected or supporting provider file, explicitly reviewed.

The join must be unique per invoice/document and must not create economics. XLS and PDF for invoice `787303394` belong to the same provider invoice even though their file hashes differ.

The current validator accepts `.xlsx`, not the verified legacy BIFF/OLE `.xls` source. Production support therefore requires a deliberately selected, bounded XLS parser, OLE/BIFF signature validation, formula/macro/external-link rejection, and resource limits. Renaming XLS to XLSX is not acceptable.

### 4.3 Raw, event, and typed product-line layers

`FinancialImportRecord` remains the immutable raw-row record. Preserve every source value in `rawMetadata`, including rows that cannot be interpreted.

Add a future `PilotFuelingEvent` linked to the provider invoice. It owns the stable ticket/authorization event identity and shared source context: card token/masked value, source unit, location/city/state, PO, transaction date, odometer, source driver/name, exact matched Truck, and conflict/review state.

Add a future one-to-one typed interpretation, tentatively `PilotFuelProductLine`, linked to its `FinancialImportRecord`, provider invoice, and event (nullable for a non-fueling invoice adjustment). Suggested fields include:

- provider line natural key/fingerprint and parser version;
- product code and unmodified product description, if present;
- raw quantity and price plus exact decimal normalized quantity/price;
- transaction amount, retail amount, and savings in integer minor units;
- proposed category ID and mapping-version reference;
- posting state, posted event transaction ID, and posted allocation ID.

Quantity and unit price must not use JavaScript binary floating point. Use bounded Prisma `Decimal` columns or scaled integers after source precision is measured. Authoritative monetary totals remain `BigInt` minor units. Raw strings are retained regardless of parse success.

### 4.4 Canonical transaction granularity

**Final recommendation: Model C.** Keep the provider invoice as a payable/reconciliation aggregate, create one canonical `ECONOMIC` `FinancialTransaction` per fueling event, and keep each amount-bearing product row as a durable typed child line with a traceable `FinancialAllocation`. Create a separate adjustment transaction for a genuine invoice-level economic adjustment that is not a fueling event. A negative adjustment becomes a positive-minor-unit `INFLOW`/credit economic transaction so existing money invariants remain intact. Do not create an invoice-level economic transaction in addition to event transactions.

Model comparison:

- **Model A — invoice transaction plus details/allocations:** simplest bank control, but makes a weekly invoice the transaction date/company/truck/driver unit. Product analytics become allocation/raw-detail dependent, owner recovery is awkward across hundreds of lines, and month-boundary P&L cannot use the canonical transaction date correctly. It is rejected by the real requirement that purchases remain first-class economic detail.
- **Model B — invoice aggregate plus transaction per product line:** preserves every gallon/category directly and reconciles cleanly, but splits one physical stop into two or three unrelated top-level transactions, repeats shared station/card/unit context, inflates event counts, and complicates event-level duplicate/correction analysis.
- **Model C — invoice aggregate plus event transaction and child product lines:** matches the observed 698-fueling-event/1,082-product-line structure plus one adjustment, keeps one economic purchase event, preserves exact diesel/reefer/DEF detail, provides event and line idempotency, and still rolls all event/adjustment amounts to one invoice and one bank expectation. It is selected.

`FinancialTransaction.amountMinor` for an event equals the exact sum of its child product-line amounts. Its economic date is the source transaction date, not invoice billing date. Child product lines are first-class queryable records, not disposable JSON. Each line has one or more line-linked allocations whose total equals the line amount and whose category/Truck/other dimensions drive product and profitability reports. The event's allocation total and evidence total equal its transaction amount.

The invoice aggregate total equals signed OUTFLOW event/positive-adjustment transactions less INFLOW credit adjustments. The invoice is the payable/control container, not another operating expense. One invoice-level `FinancialExpectation` represents the bank outflow. This produces direct transaction/event queries while preventing the bank debit, PDF, Relay report, invoice container, or summary rows from becoming duplicate fuel expense.

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

No category or product mapping is created in this sprint. Real source validation supports future reviewed mappings of `020` to Tractor Diesel, `033` to Reefer Fuel, and `140` to DEF. The mapping must still be versioned, scoped, approved, and database-backed; parser source code must not make category identity mutable or account-global by accident.

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

### 8.1 Management reporting semantics

Event transactions use the actual source transaction date. Invoice billing date and period remain payable/control attributes. Consequently, July management reporting includes July-dated events from the 06/29-07/05 and 07/27-08/02 invoices, excludes the June and August events in those invoices, and retains the observed late-billed 04/22 event in April economics with an out-of-period audit/review marker. Weekly invoice and bank reconciliation remain whole-invoice controls.

Truck reports query line-linked allocations by canonical Truck and product type, then aggregate exact gallons, actual cost, retail amount, savings, event count, state/station, and source period. Year/make/model, ownership, and equipment-use cohorts come from the canonical Truck/Trailer records as-of a defined reporting rule; they are not FinancialCategory values.

Driver reports preserve source driver text for context but include a canonical Driver only after a separate historically valid, confidence-backed attribution is confirmed. Current driver assignment and source name alone cannot populate driver performance. A Driver report may then aggregate gallons, cost, effective price, locations, and Trucks; MPG and cost per mile additionally require reliable mileage/odometer or TMS evidence.

Fleet reports can compare company-owned versus owner-operator, model year/make/model, and reefer/dry-van operations without recategorizing fuel. `020`, `033`, and `140` remain accounting/product categories; Truck, Trailer, Owner, Driver, and operating cohort remain dimensions.

## 9. Exact invoice reconciliation

For a parsed invoice:

```text
parsedDetailTotalMinor = sum(all amount-bearing Pilot economic lines)
differenceMinor = parsedDetailTotalMinor - invoiceTotalMinor
```

Use exact signed integer minor units during invoice control; posting converts each signed economic line/event to positive `amountMinor` plus `direction`. There is no tolerance and no silent rounding.

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
5. **Posting:** unique invoice/event-to-canonical-transaction and product-line-to-allocation relations make confirmation idempotent. A database constraint prevents one event or adjustment from creating multiple economic transactions.
6. **Overlap:** compare line hashes across prior invoices/reports in the same provider account and overlapping periods. Preserve duplicates for review; never silently discard their amounts.

Conflicting files for the same invoice natural key should attach as supplemental evidence and set `NEEDS_REVIEW`; they must not overwrite the previously stored file or economics.

## 12. XLS and PDF relationship

- The verified BIFF/OLE XLS is the preferred structured source after strict signature/header validation.
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
2. verify `READY`, exact invoice total, active categories, in-group dimensions, and no event/adjustment already posted;
3. create one DRAFT or POSTED `ECONOMIC` OUTFLOW `FinancialTransaction` per fueling event and one directional `ECONOMIC` transaction per real invoice-level adjustment (negative source adjustment becomes INFLOW), using the source economic date;
4. link every primary product-line/adjustment evidence record with exact minor units;
5. create product-line-linked allocations with category, Truck, optional company/owner/program, and null trailer unless reviewed evidence exists;
6. verify each line's allocations equal the line, each event's lines/evidence/allocations equal its transaction, and all event/adjustment transactions equal the invoice total;
7. create exactly one invoice-level bank-payment expectation linked to the provider invoice aggregate;
8. create invoice-level and transaction audit events with parser/mapping versions and safe identifiers;
9. atomically mark the provider invoice POSTED and retain all posted event/adjustment relations.

Retry with the same idempotency key returns the prior successful result. Database uniqueness on provider invoice, event transaction, adjustment transaction, raw-line natural key, and source-line allocation is authoritative. A partial failure rolls back all canonical writes; private source documents and preview records remain for retry/review.

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

- `ECONOMIC`: affects operating income/expense (the Pilot event and adjustment transactions);
- `CASH_SETTLEMENT`: movement that settles an economic obligation (the bank debit);
- `RECOVERY`: owner/truck chargeback or settlement deduction against an expense;
- existing `TRANSFER`: internal cash movement.

This role must be explicit data, not inferred from category, description, source type, or sign. Operating expense totals include only `ECONOMIC` outflows. Cash controls include `CASH_SETTLEMENT`; recovery reports include `RECOVERY`. Linking/matching explains how they settle the economic transaction without counting them as additional fuel expense.

Until that role exists, do not post both Pilot expense and bank debit into current operating totals. This is a schema/design blocker for a production bank adapter, not for preview parsing.

### 16.1 Three-way control

1. `SUM(signed Pilot event/product economics + signed adjustments) = provider invoice total`, with exact zero difference.
2. The provider invoice's single payable expectation is matched to actual bank debit(s). A bank debit is `CASH_SETTLEMENT`, never Fuel expense.
3. Each recoverable Truck/Owner product-line allocation creates an exact recovery obligation matched to settlement deduction(s). A deduction is `RECOVERY`, never another expense.

All three levels retain independent evidence and match history. An invoice PDF and Relay report are corroborating evidence only. The controls can therefore expose missing/duplicate event lines, invoice mismatch, missing/duplicate bank payment, wrong/unmatched Truck, and under/over/duplicate owner recovery without changing the original expense.

## 17. Truck/owner settlement reconciliation

For every posted Pilot product-line allocation attributable to a recoverable owner/truck, create a future recovery obligation linked to that exact allocation:

- source allocation and invoice;
- truck and optional OWNER_OPERATOR `FinancialParty`;
- expected recovery minor units;
- recovered/waived minor units and status;
- effective settlement period;
- immutable match and audit history.

The current recovery fields are transaction-wide. Even though an event normally has one Truck, recovery must remain allocation/product-line based so partial product treatment, adjustments, corrections, and multi-dimensional allocations remain exact. Extend recovery to allocation-level obligations or add a dedicated `FinancialRecoveryExpectation`; do not duplicate owner recovery fields independently on provider rows.

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

1. provider invoice/import aggregate with natural-key uniqueness, exact totals, parse version, status, and posted event/adjustment relations;
2. invoice-to-`FinancialStatement` join with structured/documentary/supplemental role;
3. typed `PilotFuelingEvent` with stable invoice-scoped provider identity and one-to-one posted `FinancialTransaction` relation;
4. typed `PilotFuelProductLine` linked one-to-one with `FinancialImportRecord`, its event, and exact `Decimal(18,2)` quantity/`Decimal(18,7)` price;
5. typed invoice-adjustment record for economic non-event rows;
6. multi-issue import review records with audited resolution;
7. provider product mapping with version/effective state and category relation;
8. traceable `FinancialAllocation.sourceImportRecordId` or typed-product-line relation and uniqueness;
9. explicit `FinancialTransaction` accounting/control role to separate economics, cash settlement, and recovery;
10. provider-invoice relation on `FinancialExpectation` (or a restrictive join) for one invoice-level payable without inventing an invoice expense transaction;
11. reviewed expectation/payment candidate support for ambiguity and over/under payment;
12. allocation-level recovery obligation and settlement-deduction matches;
13. indexes on operating group + provider identity, invoice natural key, line/event hash, issue state, unit, product, transaction date, posted relation, and match state.

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

- exact `StatementEFS_US` metadata/two-row-header/final-`Total:` structure using synthetic BIFF fixtures modeled on all five periods;
- 20-column detail parsing, product/event/adjustment/control-row classification, and explicit rejection of changed layouts;
- verified 020/033/140 provider-description mapping through a reviewed mapping version; unknown codes stay reviewable and remain in totals;
- event grouping for 020, 020+140, 020+033, 020+033+140, single-code events, and defensive repeated-code lines;
- exact quantity scale 2, price scale 7, minor-unit money, literal control totals, and calendar-year derivation across year/month boundaries;
- out-of-period late billing, the synthetic negative invoice adjustment, no-time source dates, and summary-row double-count prevention;
- malformed workbook, formula, external link, oversized/zip-bomb, invalid MIME/signature, and row/cell limits;
- legacy XLS signature accepted only by the bounded Pilot path; extension spoofing and XLSX renaming rejected.

Control tests:

- detail sum equals invoice exactly and one-cent mismatch fails;
- invalid/unknown/unmatched rows remain in totals;
- PDF + XLS attach to one invoice and cannot create two expenses;
- same bytes/different name, same invoice/different bytes, repeated row, overlapping report, and corrected-file conflicts;
- exact unit match, leading-zero preservation, no match, ambiguity, cross-group denial, and no automatic Truck/Driver creation;
- reefer line retains Truck and null Trailer without evidence;
- preview makes zero canonical writes;
- confirm is atomic and idempotent under retries/concurrency;
- every product line allocation equals its line, every event equals its lines, and the signed event/adjustment rollup equals the invoice total exactly;
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

### Phase 0 — source verification (complete)

- five BIFF/OLE XLS and matching PDF pairs inspected read-only;
- provider invoice identity/dates, headers, detail/control rows, product codes, signs, precision, event keys, and exact totals verified;
- no real source or identifier committed; implementation fixtures must be synthetic/redacted.

### Phase 1 — preview-only Pilot adapter

- migration for invoice/document aggregate, fueling events, typed product lines/adjustments, issues, and mappings;
- bounded legacy-XLS parser and exact event/invoice control totals;
- exact Truck proposals and product review;
- preview UI/API with no canonical posting.

### Phase 2 — reviewed posting

- product mappings and explicit row resolutions;
- product-line-to-allocation traceability;
- locked idempotent event/adjustment transaction posting with one invoice aggregate;
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

## 24. Remaining implementation questions and blockers

Real fixture validation resolved source format, sheet/header/detail/control rules, verified product meanings, precision, invoice totals, PDF roles, event grouping, and month boundaries. Before production posting, the implementation review must still answer:

1. Which maintained, sandboxed library will parse legacy BIFF/OLE XLS with explicit size/record/time limits and no formula/macro/external-link execution?
2. Can Pilot reissue an invoice number with corrected detail, and what provider revision signal distinguishes correction from conflict?
3. Are source unit numbers operating-group unique in intended deployments, and which leading zeroes/punctuation are semantically significant? Ambiguity remains blocking regardless.
4. How should the source's text date year be resolved for a genuinely late-billed line more than one year from the invoice period? Such ambiguity must require review.
5. Are company-owned Truck expenses ever recoverable, or only owner-operator expenses?
6. Which settlement fields identify invoice/week, Truck, Owner, and deduction type, and can one deduction cover multiple event lines?
7. Which historically valid operational evidence is sufficient to promote source driver context to canonical Driver attribution?
8. What is the reviewed behavior for a future event containing both positive and negative product components, which was not observed in these five fixtures?

These are implementation/product-policy blockers for production posting, bank matching, recovery, or driver performance—not blockers to approving the Model C architecture or beginning a preview-only adapter after review.
