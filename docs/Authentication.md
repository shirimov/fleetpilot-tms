# Authentication and Company Authorization

FleetPilot uses Auth.js with GitHub OAuth for its first trusted identity
provider. The browser receives an encrypted, HttpOnly session cookie. Route
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

OAuth accounts are linked by provider account ID. The first successful login
creates or links the normalized provider email to an internal user. A user must
remain active and have a company membership before company data is accessible.

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
exist. If a full database rollback is required, first export the new tables and
nullable relation values, disable authentication traffic, then reverse foreign
keys, indexes, columns, tables, and finally the enum additions in dependency
order.

## Enforcement boundary

This foundation protects company and Task Manager APIs. Other FleetPilot modules
still require a deliberate route-by-route tenant-scoping rollout; the presence
of these helpers must not be interpreted as automatic protection for routes
that do not call them.
