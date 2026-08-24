# Accounting Categories and Dimensions

## Category versus dimension

A category answers what money was for. A dimension answers who or what the
same economic transaction belongs to. Equipment unit numbers, owners,
customers, loads, companies, and programs are never category names.

`FinancialCategory` is an arbitrary-depth self-referencing tree. Its explicit
`FinancialCategoryType` remains authoritative financial meaning; behavior is
not inferred from names or ancestors. Existing categories remain root records.

`FinancialAllocation` remains the transaction-split record and continues to
reference canonical Company, Truck, Trailer, Driver, Employee, Load, Customer,
and FinancialParty rows. It now optionally references `FinancialProgram` as a
general-purpose program/cost-center dimension. A transaction is not duplicated
when it has several dimensions.

General overhead is represented by an allocation whose category has explicit
`OVERHEAD` meaning and which does not falsely require an equipment dimension.
This sprint does not allocate overhead to equipment.

## Dates and exact money

Financial calendar inputs use `YYYY-MM-DD` and are validated as real Gregorian
dates. The server stores the chosen calendar date at UTC midnight and displays
the date portion, avoiding browser timezone day shifts. The native date input
provides accessible platform calendar, month/year navigation, keyboard, and
mobile behavior. A new manual transaction defaults to the browser-local date.

Money remains PostgreSQL `BIGINT` minor units and JavaScript `bigint`. Allocation
totals, remaining amounts, and Admin Fee rates never use floating-point money.

## Programs and Admin Fee agreements

`FinancialProgram` is an operating-group-scoped dimension. `ADMIN` is one
program type, not a hard-coded special-purpose model.

`AdminFeeAgreement` records an expected weekly flat fee. Scope is explicitly
OWNER or TRUCK and references an existing owner-operator `FinancialParty` or
canonical `Truck`. Effective-dated rows are historical; rate changes create a
new row rather than overwriting the old rate. Active-period overlap is rejected
under a deterministic PostgreSQL advisory lock. An agreement does not generate
an actual transaction and never fabricates MVR, Drug Test, IFTA, or other
expense splits.

## Canonical fleet classification audit

The canonical Truck already contains model year, make, model, and owner-operator
status. Trailer already contains equipment type, including reefer/dry-van
classification. Allocations reference those records, so later reports can
derive cohorts without recategorizing transactions.

Gaps intentionally deferred:

- Truck-level operational program tags such as Dedicated, OTR, Local, Amazon,
  or Street do not yet have a canonical shared model.
- Paid-off versus financed equipment does not yet have a canonical fleet field.
- Truck ownership currently exposes `isOwnerOp` and a legacy `ownerName`; a
  first-class operational Owner relation does not exist. Accounting therefore
  reuses `FinancialParty(OWNER_OPERATOR)` for owner-scoped agreements rather
  than introducing a competing Owner model.
- No profitability, CPM, automatic recurring charge, statement adapter, bank
  feed, tax, QuickBooks, or AI calculations are part of this sprint.
