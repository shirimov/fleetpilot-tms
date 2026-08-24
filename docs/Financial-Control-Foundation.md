# Financial Control Foundation

This foundation adds an audit-first financial control layer without replacing the existing Plaid-backed Finance module or introducing general-ledger, tax, profitability, or AI accounting behavior.

## Scope and boundaries

- An `OperatingGroup` provides an explicit control boundary across one or more companies. Companies are never grouped by matching names, email addresses, or other inferred data.
- Access is server-authorized through active OWNER or ADMIN memberships in the group. MEMBER access is denied.
- Existing Company, User, Truck, Trailer, Driver, Employee, Load, and Customer records remain authoritative dimensions.
- `FinancialParty` represents financial counterparties that do not yet have a canonical FleetPilot entity.

## Money and source records

- New monetary values use positive integer minor units (`BigInt`) with a three-letter currency code and an explicit inflow/outflow direction.
- Statements are stored privately and retain source metadata, checksums, periods, import status, and raw import rows.
- Raw rows remain immutable evidence. Normalized transactions are separate control records and never replace the imported source data.
- Duplicate checks preserve suspicious records for review instead of silently dropping them.

## Evidence, reconciliation, and allocation

- Evidence links are explicitly `PRIMARY` or `CORROBORATING`.
- Primary evidence contributes to the transaction amount and cannot over-match a statement row or transaction.
- Corroborating evidence can support the same economic event without counting its value twice.
- A transaction is reconciled only when primary evidence and allocations both equal its complete amount.
- Reconciled allocations cannot be silently rewritten.
- Allocations may connect a transaction to a company, category, truck, trailer, driver, employee, load, customer, or financial party, with server-side tenant validation.

## Expectations and recovery

- Expected money is modeled independently from observed transactions and supports controlled partial matching without over-match.
- Owner-recovery fields track recoverable amounts and recovery state; they do not calculate profit or tax treatment.
- Audit events record material foundation actions, including group creation, imports, normalized transactions, evidence, allocations, and expectations.

## Initial UI

The `/accounting` workspace contains Overview, Audit Center, Statements, Transactions, Sources, and Categories. Overview reports control totals and exceptions rather than profit-and-loss results. Audit Center exposes reconciliation and expected-money gaps with drill-down to the underlying transactions.

## Deferred work

The foundation intentionally does not include provider-specific statement adapters without representative samples, QuickBooks integration, tax accounting, final profitability scoring, automated recommendations, or AI interpretation.
