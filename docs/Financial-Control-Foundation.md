# Financial Control Foundation

This foundation adds an audit-first financial control layer without replacing the existing Plaid-backed Finance module or introducing general-ledger, tax, profitability, or AI accounting behavior.

## Scope and boundaries

- An `OperatingGroup` provides an explicit control boundary across one or more companies. Companies are never grouped by matching names, email addresses, or other inferred data.
- Access is server-authorized through active OWNER or ADMIN memberships in the group. MEMBER access is denied.
- Existing Company, User, Truck, Trailer, Driver, Employee, Load, and Customer records remain authoritative dimensions.
- `FinancialParty` represents financial counterparties that do not yet have a canonical FleetPilot entity.

## Money and source records

- New monetary values use positive integer minor units (`BigInt`) with a three-letter currency code and an explicit inflow, outflow, or transfer direction.
- Transfers use one canonical transaction with distinct source and destination accounts. Both accounts and the transaction must share a currency; transfers are excluded from operating income, expense, and net totals.
- Statements are stored privately and retain source metadata, checksums, periods, import status, and raw import rows.
- Raw rows remain immutable evidence. Normalized transactions are separate control records and never replace the imported source data.
- Duplicate checks preserve suspicious records for review instead of silently dropping them.

## Evidence, reconciliation, and allocation

- Evidence links are explicitly `PRIMARY` or `CORROBORATING`.
- Primary evidence contributes to the transaction amount and cannot over-match a statement row or transaction.
- Corroborating evidence can support the same economic event without counting its value twice.
- A transaction is reconciled only when primary evidence and allocations both equal its complete amount.
- Reconciled allocations cannot be silently rewritten.
- Evidence and expectation matching acquire deterministic PostgreSQL transaction-scoped advisory locks before checking aggregate caps. Concurrent requests therefore cannot collectively over-match a source record, expectation, or transaction.
- Evidence, expectations, transactions, transfers, and source accounts must use the same currency. FX conversion is intentionally unsupported.
- Allocations may connect a transaction to a company, category, truck, trailer, driver, employee, load, customer, or financial party, with server-side tenant validation.

## Expectations and recovery

- Expected money is modeled independently from observed transactions and supports controlled partial matching without over-match.
- Owner recovery distinguishes recovered cash from waived balances. Authorized actions record cumulative partial/full recovery or explicitly waive the remainder, and every action is audited.
- Audit events record material foundation actions, including group creation, imports, normalized transactions, evidence, allocations, and expectations.

## Initial UI

The `/accounting` workspace contains Overview, Audit Center, Statements, Transactions, Sources, and Categories. Overview reports control totals and exceptions rather than profit-and-loss results. Audit Center exposes reconciliation and expected-money gaps with drill-down to the underlying transactions.

Completeness is the number of fully reconciled non-transfer transactions divided by all non-voided, non-transfer transactions, expressed in integer basis points and bounded from 0 through 10,000. With no transactions it is `null`, not a fabricated percentage. Statement metrics separately report registered, successfully imported, failed, and pending counts; raw-record totals and each exception class are reported independently.

## Deferred work

The foundation intentionally does not include provider-specific statement adapters without representative samples, QuickBooks integration, tax accounting, final profitability scoring, automated recommendations, or AI interpretation.
