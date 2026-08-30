# Bank Transaction Ledger Foundation

FleetPilot's bank ledger is a read-only transaction inbox. Provider source data
is retained separately from FleetPilot categories, review state, notes, and
entity allocations. Synchronization never creates money movement or posts a
general-ledger entry.

## Provider configuration

Live provider actions fail closed unless all of these server-only values exist:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `BANK_TOKEN_ENCRYPTION_KEY` (32 random bytes, encoded as 64 hex characters or base64)

`PLAID_ENV` selects `sandbox`, `development`, or `production` and defaults to
`sandbox`. None of these variables use a `NEXT_PUBLIC_` prefix. Access tokens are
encrypted with AES-256-GCM before persistence. Existing legacy plaintext tokens
are not used by the new synchronization service and must be reconnected or
migrated through an approved operational process.

Plaid HTTP requests use a 30-second timeout. Synchronization performs no
automatic retries and caps cursor pagination at 20 pages per explicit run.

When provider configuration is absent, the Accounts view shows a disabled
provider state and synchronization cannot start. File-import adapters can use
the same `BankProviderTransaction` ingestion boundary later without changing the
canonical transaction model.

## Source and classification boundaries

Provider identity, dates, original description, merchant, amount, currency,
direction, provider category, pending/posted lifecycle, reference fields, and
source metadata are provider source fields. User review updates only the linked
classification and allocation records.

Repeated provider IDs are idempotent per connection. Pending and posted IDs are
retained in the external identity table so a pending-to-posted transition updates
one canonical row. Provider removals mark source rows removed; they do not erase
history.

Classification can be company-level overhead or exact minor-unit allocations to
canonical Truck, Trailer, Driver, or FinancialParty records. Cross-company and
cross-operating-group references are rejected server-side. Review and source
lifecycle changes create `FinancialAuditEvent` records.

## Deployment

The migration is additive and backfills legacy Plaid connection/account/
transaction identities and exact minor-unit amounts. Normal controlled staging
deployment must run `prisma migrate deploy` before recreating the application.
No real provider should be enabled until the institution/provider account,
consent scope, encryption-key custody, retention expectations, and revocation
procedure are operationally approved.
