# Final Tenant-Isolation Security Review

Issue: [#10](https://github.com/shirimov/fleetpilot-tms/issues/10)  
Pull request: [#11](https://github.com/shirimov/fleetpilot-tms/pull/11)

## Review scope and disposition

The repository contains 74 executable server boundaries:

- 73 HTTP handlers in 44 App Router API route files;
- one public login Server Action that starts GitHub OAuth.

There is no middleware/proxy, cron handler, background worker, scheduled job,
or server action outside login. Auth.js owns the OAuth/session callback route.
Telegram is the only application webhook.

All 73 HTTP handlers are accounted for: 60 are tenant scoped, 12 are
intentionally fail closed, and the FMCSA DOT/MC lookup is a documented public
external-data exemption. The login action is public by design and accepts no
identity or tenant selector.

The authorization and tenant-isolation implementation is ready for final
security review. Merge readiness remains blocked by the dependency advisory
inventory described below.

## Threat model

The primary adversary is an authenticated or unauthenticated caller attempting
to read or mutate another FleetPilot company's records by changing route IDs,
query parameters, request bodies, headers, or cached browser state. Secondary
risks are privilege escalation by a MEMBER, webhook spoofing, provider-account
mis-linking, cross-user cache reuse, path traversal, and unowned legacy data.

Security boundaries are the trusted Auth.js server session, internal `User`,
validated `CompanyMembership`, and deterministic active-company resolution.
Employee, driver, actor, owner, and client-supplied company identifiers are
resource selectors only; none establish identity or membership.

Intentional exceptions:

- `/api/lookup/dot` is public and queries FMCSA data after input validation.
- `/api/telegram/webhook` authenticates the provider secret rather than a user
  session, then fails closed because no integration-to-company mapping exists.
- Auth.js callback endpoints and the login Server Action are necessarily public
  authentication entry points.

## Authentication flow

```text
Login Server Action
  -> Auth.js GitHub OAuth
  -> fetch GitHub profile + verified primary email
  -> link (provider, providerAccountId) transactionally
  -> store internal User.id in signed JWT
  -> expose only internal User.id in the server session
```

Provider identity is keyed by the unique provider/account pair. Automatic
email linking is allowed only for a pre-provisioned, otherwise unlinked user
with a verified primary GitHub email. Inactive internal users are rejected by
authorization even if an older signed session remains.

## Authorization and tenant-isolation flow

```text
HTTP handler
  -> requireUser()
  -> requireActiveCompany(minimumRole)
  -> validate CompanyMembership and active user
  -> query direct companyId or verified parent ownership
  -> verify every related mutation ID in the same company
  -> execute multi-record writes transactionally
  -> return non-enumerating 404 for missing or foreign records
```

The active company is not taken from a request header or business-resource
identifier. Switching it accepts a company selector only after validating the
user's membership. Task activity actors are always derived from the trusted
session. Legacy actor/display strings remain readable without becoming
verified user attribution.

## Schema ownership diagram

```text
Company
├── CompanyMembership ── User ── AuthAccount
├── Truck
│   ├── TruckInspection
│   ├── Settlement
│   └── Load
├── Driver? ── DriverOrientation
├── Employee? ── EmployeePayment
│                 EmployeeEscrow* ── EscrowTx
├── BankAccount? ── BankSubAccount / BankTransaction
└── TaskProject? ── TaskBoard / TaskCard / labels/comments/attachments/activity

? nullable ownership: legacy null rows are hidden pending reconciliation
* legacy string employee reference: access resolves through a verified Employee
```

Direct ownership exists on Truck and Load. Driver, Employee, BankAccount, and
TaskProject ownership is nullable for backward compatibility; null rows fail
closed. Settlements, inspections, orientations, payments, escrow, Plaid child
records, and task child records are scoped through verified parents.

EmailAccount/Email, DispatchReserve, and TmFund have no trustworthy ownership
model and their handlers remain blocked. Telegram and QuickManage have no
reviewed integration-to-company mapping and remain blocked.

Foreign keys, deletion, and orphan policy:

- authentication accounts and memberships cascade with their parent;
- active-company pointers use `SET NULL`;
- Driver and Employee company ownership uses `SET NULL` so deleting a company
  does not falsely reassign legacy operational identity;
- task cards use cascades for dependent content, while TaskActivity retains
  immutable entity identity and uses `SET NULL` for a deleted card;
- TaskActivity project deletion is `RESTRICT`;
- nullable legacy rows are never inferred into a company;
- frequently filtered ownership and timeline fields are indexed;
- membership and provider-account uniqueness are database enforced.

The migrations are additive. Operational rollback is application-first while
retaining nullable columns; dropping them is unnecessary and could discard
reconciled ownership.

## Selector and bypass audit

Repository-wide searches covered `companyId`, `userId`, `employeeId`,
`actorId`, `ownerId`, `organizationId`, route parameters, search parameters,
request JSON, URL access, cookies, and identity-like headers.

Remaining client selectors identify requested resources only. Their ownership
is verified against the active company before reads or writes. There are no
`x-company`, `x-user`, custom actor, or custom identity headers used for
authorization. The Telegram secret header is provider authentication and does
not grant access to a FleetPilot company.

## Fail-closed routes

The 12 blocked handlers are:

- reserve: GET and POST;
- TM Fund: GET and POST;
- inbox: GET and PATCH;
- inbox accounts: GET, POST, and DELETE;
- inbox synchronization: POST;
- QuickManage statistics: GET;
- Telegram webhook: POST after provider verification.

Blocked handlers do not parse caller resource identifiers, query Prisma, read
global cache files, invoke integrations, or return partial data. Company-user
routes authenticate first and then return the same sanitized 503 response.
Telegram returns sanitized 401/503 responses. All blocked and authorization
error responses carry `Cache-Control: private, no-store`.

## Cache review

- service worker: `/api/**` GET requests use `NetworkOnly`;
- Next.js Route Handlers: dynamic session/cookie access prevents static
  generation, and Next.js 16 does not cache Route Handler GET responses by
  default;
- React/Next data cache: no `cache`, `unstable_cache`, `force-cache`, tagged
  cache, or revalidation API is used for company data;
- pages may be statically generated because they contain only client shells;
  protected company data is loaded from authenticated APIs;
- inspection form `localStorage` contains a local unsent draft, not an
  authenticated API response;
- authenticated API errors and blocked responses explicitly use private
  no-store headers.

## Dependency audit

At review time, `npm audit` reports 38 known advisories: 29 high, 8 moderate,
and 1 low. There are no critical advisories. A production-only audit reports
37 because Prisma tooling is currently installed as a production dependency.

Important chains include Next.js build/runtime transitive packages, both PWA
packages and Workbox, Prisma tooling, Plaid's Axios dependency, mail parsing,
and the legacy `node-imap`/`utf7` chain. The legacy inbox routes are fail
closed, but installed vulnerable packages still require deliberate remediation.
`next-pwa` is also duplicated; only `@ducanh2912/next-pwa` is configured.

No package was upgraded during this authorization PR because the safe fixes
span framework, ORM, build tooling, and an IMAP package with no automatic fix.
A separate reviewed dependency-remediation change must remove the unused PWA
package, update supported direct dependencies, retest Auth.js beta
compatibility, and document any accepted build-only risk. Production rollout
and merge remain blocked until that review is complete.

## Test coverage

Tests cover trusted authentication, inactive users, missing membership,
deterministic company resolution, role enforcement, provider linking,
membership uniqueness, spoofed selectors, cross-company reads and writes,
not-found equivalence, task actors, dashboard aggregation, fleet relations,
settlements, Plaid ownership, upload authorization, employees, payroll,
escrow, QuickManage/Telegram fail-closed behavior, and service-worker caching.

Source-level regression tests assert that ownership-blocked routes authenticate,
return unavailable responses, never access Prisma/request bodies/global files,
and emit non-cacheable responses.

## Production rollout checklist

- [ ] Resolve or formally accept every dependency advisory with security review.
- [ ] Back up the production database and verify restore procedures.
- [ ] Confirm all committed migrations match production migration history.
- [ ] Apply additive migrations in committed order.
- [ ] Reconcile nullable company ownership from independently verified data.
- [ ] Leave unproven legacy rows null and hidden.
- [ ] Configure Auth.js/GitHub secrets through production secret management.
- [ ] Rotate and remove embedded QuickManage credentials.
- [ ] Keep reserve, TM Fund, inbox, Telegram, and QuickManage functionality
  blocked until reviewed ownership mappings exist.
- [ ] Deploy the reviewed commit only.
- [ ] Run unauthenticated, role, same-company, and cross-company smoke tests.
- [ ] Inspect response cache headers and service-worker behavior.
- [ ] Monitor authorization failures without logging secrets or personal data.

## Deployment checklist

- [ ] Verify deployment repository, branch, and exact commit SHA.
- [ ] Run Prisma migration status without reset, resolve, or db push.
- [ ] Run Prisma validate/generate, TypeScript, tests, Playwright, and build.
- [ ] Confirm required environment keys exist without printing values.
- [ ] Deploy application after migrations and ownership reconciliation approval.
- [ ] Verify blocked routes remain 503 and tenant routes remain isolated.

## Rollback checklist

- [ ] Stop traffic to the affected application version if isolation fails.
- [ ] Roll the application back to the last reviewed commit.
- [ ] Do not drop additive nullable ownership columns.
- [ ] Do not use `migrate reset`, `db push`, or destructive SQL.
- [ ] Preserve audit/activity data and database backups.
- [ ] Re-run cross-company isolation checks before restoring traffic.

