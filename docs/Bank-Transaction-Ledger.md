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
- `PLAID_PRODUCTS=transactions` (any money-movement product makes configuration fail closed)
- `PLAID_WEBHOOK_URL` for signed incremental-update delivery
- `PLAID_REDIRECT_URI` when OAuth institutions require a return URI

`PLAID_ENV` selects `sandbox`, `development`, or `production` and defaults to
`sandbox`. None of these variables use a `NEXT_PUBLIC_` prefix. Access tokens are
encrypted with AES-256-GCM before persistence. Existing legacy plaintext tokens
are not used by the new synchronization service and must be reconnected or
migrated through an approved operational process.

Plaid HTTP requests use a 30-second timeout. Synchronization performs no
automatic retries and caps cursor pagination at 20 pages per explicit run.
Each normal refresh requests provider account snapshots and transaction cursor
updates independently. Provider current and available balances are stored as
exact minor units and are never derived from transaction arithmetic.
`BankSubAccount.lastSyncedAt` records the last successful balance refresh while
`BankAccount.lastSync` records the last successful transaction refresh. A
partial failure preserves the last known balance and its timestamp, records a
sanitized error, and does not claim that both sides refreshed successfully.
Duplicate in-process refresh requests for one connection are coalesced.

Plaid Link is opened only from the trusted active-company context. Initial Link
requests enable Transactions only; update-mode Link uses the existing encrypted
access token and requests no new products. Public tokens are exchanged only on
the server, and permanent access tokens are never returned to browser code.

Plaid webhooks are verified using the official ES256 JWT key endpoint, a
five-minute signature-age bound, and the signed SHA-256 request-body hash. Only
`TRANSACTIONS/SYNC_UPDATES_AVAILABLE` queues synchronization. Verified payload
hashes are unique, so retries do not run duplicate syncs. Processing uses the
same bounded cursor pipeline and requires the connection creator to retain an
ADMIN/OWNER operating-group role. Other verified webhook types are retained as
ignored metadata without storing the raw payload.

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

Plaid Transactions commonly provides up to 24 months of initial history,
subject to institution and account availability. FleetPilot does not claim or
fabricate a longer period. Webhooks require the public HTTPS URL to be entered in
Alpha configuration before a live Item is connected.
