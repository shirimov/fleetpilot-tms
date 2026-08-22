# Authentication and Company Authorization

FleetPilot uses Auth.js with GitHub OAuth and an employee-friendly email magic
link. The browser receives an encrypted, HttpOnly session cookie. Route
handlers derive the internal user ID from the verified server session and then
reload the user and company membership from PostgreSQL before authorizing data.

Client-provided user, employee, company, actor, or identity-header values are
never accepted as proof of identity.

## Data model

```text
User 1 ── * AuthAccount
User 1 ── * CompanyMembership * ── 1 Company
User * ── 0..1 active Company
User 1 ── * TaskComment       (nullable verified author)
User 1 ── * TaskActivity      (nullable verified actor)
```

Membership roles are ordered `MEMBER`, `ADMIN`, and `OWNER`. The authorization
data-access layer provides:

- `requireUser`
- `requireActiveCompany`
- `requireCompanyMembership`
- minimum-role checks

When `User.activeCompanyId` is unset, the oldest membership by `createdAt` and
then `id` is selected deterministically. If an explicit active company is set
but its membership is invalid, access is denied rather than falling back to a
different tenant.

## Provider and environment assumptions

GitHub OAuth avoids introducing password storage, reset, verification, and MFA
workflows that do not exist in this repository. Production rollout requires
operators to configure `AUTH_SECRET`, `AUTH_GITHUB_ID`, and
`AUTH_GITHUB_SECRET`, plus the correct GitHub OAuth callback URL. Those values
must remain outside source control.

OAuth accounts are linked by provider account ID. FleetPilot always fetches the
GitHub email list and requires the primary address to be verified. The first
successful login creates an internal user or links a pre-provisioned user that
has no authentication account. An additional provider may link to that same
user only through the provider's verified normalized email; a second account
from the same provider is rejected. A user must remain active and
have a company membership before company data is accessible.

Email authentication is fail-closed behind `EMAIL_AUTH_ENABLED`. It requires
`EMAIL_AUTH_RESEND_API_KEY`, `EMAIL_AUTH_FROM`, `AUTH_SECRET`, and the canonical
HTTPS `AUTH_URL`. Only an existing, active user with a company membership
receives a link. The public response is identical for known, unknown, inactive,
membership-free, and rate-limited addresses.

Magic links contain 32 random bytes in a URL fragment so the raw token is not
sent in an HTTP request line, proxy log, or referrer. PostgreSQL stores only
their SHA-256 hash,
the normalized intended email, user relation, expiry, and consumption time.
They expire after 15 minutes and an atomic conditional update makes them
single-use under concurrent requests. Request identifiers are HMAC-hashed with
`AUTH_SECRET`; requests are rate-limited over 15 minutes by both email and
source IP. Resend receives the link over HTTPS, and automated tests replace
delivery with an in-process mock.

Pre-provisioning a user by email is an invitation and must use an address whose
ownership has been independently verified. Stale pre-provisioned users should
be deactivated rather than left available for first-login linking. Concurrent
first-login attempts are protected by serializable transactions and database
uniqueness constraints; a conflict fails closed and the user can retry.

An authenticated user may request an active-company change through
`PATCH /api/auth/company`. The submitted company ID is only a selector: the
server reloads the user and verifies membership before persisting it. It is
never accepted as authorization evidence.

## Legacy data

The migration is additive:

- `TaskComment.author` remains unchanged and readable.
- `TaskActivity.actorId` remains unchanged and readable.
- nullable `authorUserId` and `actorUserId` hold verified identities for new
  writes.
- nullable `TaskProject.companyId` remains nullable.

Unscoped task projects are not assigned automatically and are not returned by
tenant-scoped APIs. Before rollout, an operator must review ownership:

```sql
SELECT id, name, "companyId"
FROM "TaskProject"
WHERE "companyId" IS NULL
ORDER BY "createdAt", id;
```

After ownership is independently verified, each project can be assigned to its
confirmed company in a reviewed, explicit backfill. No bulk assignment to an
arbitrary or first company is safe.

## Migration and rollback

The migrations create identity and membership tables, extend the activity actor
enum, and add nullable verified-author/actor columns. They contain no drops or
legacy-data rewrites.

Application rollback is safe while the additive schema remains installed.
Dropping the new schema objects is not recommended after users or memberships
exist. PostgreSQL enum value additions are not directly reversible. If a full
database rollback is required, first export the new tables and nullable
relation values, disable authentication traffic, then reverse foreign keys,
indexes, columns, and tables. Removing the `USER` enum value requires recreating
the enum and rewriting dependent columns; application rollback while retaining
the additive schema is the preferred operational procedure.

## Enforcement boundary

This foundation protects company and Task Manager APIs. Other FleetPilot modules
still require a deliberate route-by-route tenant-scoping rollout; the presence
of these helpers must not be interpreted as automatic protection for routes
that do not call them.

Production authentication must not be enabled until the following existing
company-owned route groups derive their tenant from `requireActiveCompany` and
apply it in every database query:

- dashboard, trucks, loads, drivers, settlements, and inspections
- employees, payroll, escrow, reserve, and TM Fund
- inbox and Plaid accounts/transactions
- uploads and any object-storage access path

The Telegram webhook needs a separately authenticated integration-to-company
mapping; an end-user session is not an appropriate trust mechanism for it.
Nullable or indirectly owned legacy records (including drivers, settlements,
bank accounts, and inspections) must remain hidden until ownership is
independently established. These gaps are a rollout blocker, not an accepted
authorization fallback.
