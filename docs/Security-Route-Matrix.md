# Legacy Route Tenant-Isolation Matrix

Issue: [#10](https://github.com/shirimov/fleetpilot-tms/issues/10)

Audit scope: all 59 App Router API route files (99 HTTP handlers),
the one login Server Action, database access outside route handlers, filesystem
upload/download handlers, dashboard aggregation, Plaid, email sync, Telegram,
and QuickManage integration code.

No additional application server actions or route handlers were found outside
this inventory. No middleware/proxy, cron handler, background job, or scheduled
worker exists. Auth.js owns the OAuth callback route; Telegram is the only
application webhook. Client components call these APIs and are not
authorization boundaries.

Current disposition: 99 handlers audited, 86 tenant-scoped, 12 intentionally
blocked, one reviewed public exemption, and zero handlers left vulnerable.
Blocked handlers remain production rollout blockers until their ownership
models are reviewed and implemented.

## Legend

- Auth/scope: `yes` is enforced today, `no` is missing, `partial` is not safe
  for every operation, and `external` has no FleetPilot tenant resource.
- Role: minimum intended company role. `Integration` requires a separately
  verified integration-to-company identity.
- Risk: `C` confidentiality/read leakage, `M` mutation/integrity, `S` secrets
  or files, and `A` cross-company aggregation.
- Tests: `U` unauthenticated/inactive/non-member, `X` cross-company read/write
  and not-found equivalence, `I` spoofed identifiers, `R` role enforcement,
  `F` file ownership, and `G` aggregation isolation.
- Status: `protected`, `vulnerable`, `audit`, or `exempt`.

## Authentication, company, and Task Manager foundation

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/[...nextauth]` | GET, POST | OAuth/session | Auth.js | n/a | n/a | S | provider/link tests | protected |
| login server action | POST | OAuth sign-in | Auth.js | n/a | n/a | S | provider/link tests | protected |
| `/api/auth/company` | PATCH | active company | yes | yes | MEMBER | M | U/X/I | protected |
| `/api/companies` | GET | company | yes | yes | MEMBER | C | U/X | protected |
| `/api/companies` | POST | company/membership | yes | transaction | user | M | U/I | protected |
| `/api/companies/[id]` | PATCH | company | yes | yes | ADMIN | C/M | U/X/I/R | protected |
| `/api/companies/[id]` | DELETE | company | yes | yes | OWNER | C/M | U/X/I/R | protected |
| `/api/tasks` | GET | projects | yes | yes | MEMBER | C | U/X/I | protected |
| `/api/tasks` | POST | project | yes | yes | MEMBER | M | U/X/I | protected |
| `/api/tasks/projects/[id]/board` | GET | board/cards | yes | yes | MEMBER | C | U/X/I | protected |
| `/api/tasks/cards` | POST, PATCH, DELETE | cards | yes | yes | MEMBER | C/M | U/X/I | protected |
| `/api/tasks/cards/[id]/move` | POST | card ordering | yes | yes | MEMBER | M | U/X/I | protected |
| `/api/tasks/cards/[id]/activity` | GET | activity | yes | yes | MEMBER | C | U/X/I | protected |
| `/api/tasks/cards/[id]/checklist` | GET, POST, PATCH | checklist | yes | yes | MEMBER | C/M | U/X/I | protected |
| `/api/tasks/cards/[id]/checklist/[itemId]` | PATCH, DELETE | checklist item | yes | yes | MEMBER | C/M | U/X/I | protected |
| `/api/tasks/cards/[id]/comments` | GET, POST | comments | yes | yes | MEMBER | C/M | U/X/I | protected |
| `/api/tasks/cards/[id]/comments/[commentId]` | PATCH, DELETE | comment | yes | yes | author/ADMIN | C/M | U/X/I/R | protected |

## Dispatch Workflow Internal Alpha

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/dispatch/board` | GET | load board/aggregates | yes | direct company | MEMBER | C/A | U/X/I/G | protected |
| `/api/customers` | GET, POST | customers/contacts | yes | direct company | MEMBER | C/M | U/X/I | protected |
| `/api/customers/[id]` | PATCH | customer/contacts | yes | direct company | MEMBER | C/M | U/X/I | protected |
| `/api/customers/[id]` | DELETE | customer | yes | direct company | ADMIN | C/M | U/X/I/R | protected |
| `/api/trailers` | GET | trailers/assignments | yes | direct company | MEMBER | C | U/X/I | protected |
| `/api/trailers` | POST | trailer | yes | derived company | ADMIN | M | U/X/I/R | protected |
| `/api/trailers/[id]` | PATCH, DELETE | trailer | yes | direct company | ADMIN | C/M | U/X/I/R | protected |
| `/api/trailers/[id]/documents` | POST | trailer document | yes | parent trailer | ADMIN | C/M/S | U/X/I/R/F | protected |
| `/api/trailers/[id]/documents/[documentId]` | GET | trailer document | yes | parent trailer | MEMBER | C/S | U/X/I/F | protected |
| `/api/trailers/[id]/documents/[documentId]` | DELETE | trailer document | yes | parent trailer | ADMIN | C/M/S | U/X/I/R/F | protected |
| `/api/loads/[id]/transition` | POST | lifecycle | yes | direct company | MEMBER | C/M | U/X/I | protected |
| `/api/loads/[id]/activity` | GET | load activity | yes | direct company | MEMBER | C | U/X/I | protected |
| `/api/loads/[id]/documents` | POST | load document | yes | parent load | MEMBER | C/M/S | U/X/I/F | protected |
| `/api/loads/[id]/documents/[documentId]` | GET | load document | yes | parent load | MEMBER | C/S | U/X/I/F | protected |
| `/api/loads/[id]/documents/[documentId]` | DELETE | load document | yes | parent load | ADMIN | C/M/S | U/X/I/R/F | protected |

Customer, trailer, driver, truck, stop-contact, and document parent IDs are
resolved inside the active company. Load lifecycle and assignment mutations
run through DispatchService in serializable transactions; overlapping active
truck, driver, and trailer windows are rejected before mutation.

## Dashboard and shared aggregation

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/dashboard` | GET | fleet/load/settlement aggregates | yes | yes | MEMBER | C/A | U/X/G | protected |
| `/api/qm-stats` | GET | QuickManage carrier aggregates/refresh | yes | unavailable | MEMBER | C/M/S/A | U/X/R/G | blocked |
| `/api/lookup/dot` | GET | public FMCSA lookup | no | external | public | abuse | validation/rate-limit | exempt |

## Fleet, loads, settlements, and inspections

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/trucks` | GET | trucks | yes | yes | MEMBER | C | U/X | protected |
| `/api/trucks` | POST | truck | yes | yes | ADMIN | M | U/X/I/R | protected |
| `/api/trucks/[id]` | PATCH, DELETE | truck | yes | yes | ADMIN | C/M | U/X/I/R | protected |
| `/api/drivers` | GET | drivers | yes | direct company | MEMBER | C | U/X | protected |
| `/api/drivers` | POST | driver/truck | yes | verified company/truck | ADMIN | M | U/X/I/R | protected |
| `/api/drivers/[id]` | PATCH, DELETE | driver | yes | direct company | ADMIN | C/M | U/X/I/R | protected |
| `/api/loads` | GET | loads | yes | direct company | MEMBER | C | U/X | protected |
| `/api/loads` | POST | load/relations | yes | verified company/relations | MEMBER | M | U/X/I | protected |
| `/api/loads/[id]` | PATCH, DELETE | load/relations | yes | verified company/relations | MEMBER | C/M | U/X/I | protected |
| `/api/settlements` | GET | settlements | yes | parent truck | MEMBER | C | U/X | protected |
| `/api/settlements` | POST | settlement | yes | verified parents | ADMIN | M | U/X/I/R | protected |
| `/api/settlements/[id]` | PATCH, DELETE | settlement | yes | parent truck | ADMIN | C/M | U/X/I/R | protected |
| `/api/inspections/truck` | GET | truck inspections | yes | parent truck | MEMBER | C | U/X | protected |
| `/api/inspections/truck` | POST | truck inspection | yes | parent truck | MEMBER | M | U/X/I | protected |
| `/api/inspections/truck/[id]` | GET | truck inspection | yes | parent truck | MEMBER | C | U/X | protected |
| `/api/inspections/truck/latest/[truckId]` | GET | truck inspection | yes | parent truck | MEMBER | C | U/X/I | protected |
| `/api/inspections/truck/[id]/photos` | POST | inspection files | yes | parent truck, pre-write | MEMBER | C/M/S | U/X/I/F | protected |
| `/api/inspections/driver` | GET | orientations | yes | driver truck | MEMBER | C | U/X | protected |
| `/api/inspections/driver` | POST | orientation | yes | driver truck | MEMBER | M | U/X/I | protected |
| `/api/inspections/driver/[id]` | GET | orientation | yes | driver truck | MEMBER | C | U/X | protected |
| `/api/inspections/driver/latest-by-truck/[truckId]` | GET | orientation | yes | driver truck | MEMBER | C | U/X/I | protected |

Drivers now have explicit nullable company ownership. Legacy null-company
drivers remain hidden until independently reconciled; truck assignment is not
used as a substitute for driver ownership.

### Fleet and inspection remediation checklist

This phase secures the following handlers without adding artificial ownership
to child records:

- [x] `GET /api/trucks` — `MEMBER`, direct `Truck.companyId`
- [x] `POST /api/trucks` — `ADMIN`, company derived from active membership
- [x] `PATCH /api/trucks/[id]` — `ADMIN`, direct `Truck.companyId`
- [x] `DELETE /api/trucks/[id]` — `ADMIN`, direct `Truck.companyId`
- [x] `GET /api/inspections/truck` — `MEMBER`, through `Truck.companyId`
- [x] `POST /api/inspections/truck` — `MEMBER`, verify selected truck
- [x] `GET /api/inspections/truck/[id]` — `MEMBER`, through owning truck
- [x] `POST /api/inspections/truck/[id]/photos` — `MEMBER`, authorize before
  writing files
- [x] `GET /api/inspections/truck/latest/[truckId]` — `MEMBER`, verify truck
- [x] `GET /api/inspections/driver` — `MEMBER`, through driver-assigned truck
- [x] `POST /api/inspections/driver` — `MEMBER`, verify driver-assigned truck
- [x] `GET /api/inspections/driver/[id]` — `MEMBER`, through driver and truck
- [x] `GET /api/inspections/driver/latest-by-truck/[truckId]` — `MEMBER`,
  verify truck before resolving its driver
- [x] Driver list/create/update/delete — direct company scope, `MEMBER` read,
  `ADMIN` writes, and verified optional truck ownership.
- [x] Load list/create/update/delete — direct company scope and verified truck
  and optional driver ownership inside mutation transactions.

No trailer model, relation, or API handler exists in the current repository.
Trailer authorization cannot be implemented until a separately reviewed data
model and product scope exists; no truck record will be treated as a trailer.

## Employees, payroll, escrow, and company funds

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/employees` | GET | employees | yes | direct company | ADMIN | C | U/X/R | protected |
| `/api/employees` | POST | employee | yes | derived company | ADMIN | M | U/X/I/R | protected |
| `/api/employees/[id]` | GET | employee | yes | direct company | ADMIN | C | U/X/R | protected |
| `/api/employees/[id]` | PUT, DELETE | employee | yes | direct company | ADMIN | C/M | U/X/I/R | protected |
| `/api/employees/[id]/payments` | GET | payroll | yes | parent employee | ADMIN | C | U/X/R | protected |
| `/api/employees/[id]/payments` | POST | payroll | yes | verified employee | ADMIN | M | U/X/I/R | protected |
| `/api/employees/[id]/payments/[paymentId]` | PATCH | payroll | yes | verified parent/payment | ADMIN | C/M | U/X/I/R | protected |
| `/api/escrow` | GET | employee escrow | yes | verified employee | ADMIN | C | U/X/R | protected |
| `/api/escrow` | POST | employee escrow | yes | verified employee | ADMIN | M | U/X/I/R | protected |
| `/api/escrow/[id]` | GET | escrow | yes | verified employee | ADMIN | C | U/X/R | protected |
| `/api/escrow/[id]` | POST | escrow transaction | yes | verified employee | ADMIN | M | U/X/I/R | protected |
| `/api/reserve` | GET | dispatch reserve | yes | unavailable | ADMIN | C | U/X/R | blocked |
| `/api/reserve` | POST | dispatch reserve | yes | unavailable | ADMIN | M | U/X/I/R | blocked |
| `/api/tmfund` | GET | TM fund | yes | unavailable | ADMIN | C | U/X/R | blocked |
| `/api/tmfund` | POST | TM fund transaction | yes | unavailable | ADMIN | M | U/X/I/R | blocked |

These models require additive company ownership before safe tenant scoping.

### Phase 4 remediation checklist

- [x] Driver list/create/detail/update/delete — `MEMBER` read and `ADMIN`
  write; direct nullable `Driver.companyId`; verify optional truck belongs to
  the same company; hide legacy null-company drivers.
- [x] Load list/create/update/delete — `MEMBER` read and write; direct
  `Load.companyId`; verify truck and optional driver share the active company;
  ignore client company selectors.
- [x] Employee list/create/detail/update/delete — `ADMIN`; direct nullable
  `Employee.companyId`; employee identity remains separate from authenticated
  `User` and `CompanyMembership`; hide legacy null-company employees.
- [x] Employee payment list/create/update — `ADMIN`; scope through
  `Employee.companyId` and validate both route parent and payment parent.
- [x] Escrow list/create/detail/transactions — `ADMIN`; scope the legacy
  string employee reference through a verified company-owned Employee and
  write balances atomically.
- [x] QuickManage `/api/qm-stats` — require membership and fail closed until a
  reviewed company/carrier mapping and partitioned cache exist.
- [x] Service worker — use network-only behavior for authenticated `/api/**`
  responses so private tenant data is never stored in shared browser caches.

The additive ownership migration adds nullable `companyId` only to Driver and
Employee. Existing rows remain null and hidden; no ownership is inferred.

## Plaid and finance integration

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/plaid/create-link-token` | POST | link token | yes | active company | ADMIN | S/M | U/X/R | protected |
| `/api/plaid/exchange-token` | POST | access token/accounts | yes | active company | ADMIN | C/M/S | U/X/I/R | protected |
| `/api/plaid/accounts` | GET | bank accounts | yes | direct company | ADMIN | C/S | U/X/R | protected |
| `/api/plaid/accounts` | DELETE | bank account tree | yes | parent account | ADMIN | C/M/S | U/X/I/R | protected |
| `/api/plaid/transactions` | GET | bank transactions | yes | parent account | ADMIN | C/S | U/X/I/R | protected |
| `/api/plaid/transactions` | POST | Plaid sync | yes | parent account | ADMIN | C/M/S | U/X/I/R | protected |

Nullable legacy `BankAccount.companyId` rows must remain hidden until ownership
is independently reconciled.

### Finance and integration remediation checklist

- [x] Settlement list/detail/mutations — scope through `Truck.companyId`; verify
  load, truck, and driver parents before writes; `MEMBER` read, `ADMIN` write.
- [x] Reserve and TM Fund — require `ADMIN` and fail closed until additive
  company ownership is designed; never return the existing global rows.
- [x] Plaid link token — authenticated `ADMIN`; no client company selector.
- [x] Plaid exchange/sync/accounts — `ADMIN`, derive company from membership,
  require non-null `BankAccount.companyId`, and scope every child through it.
- [x] Upload download — `MEMBER`, allow only inspection paths whose inspection
  resolves through a truck owned by the active company; reject all unindexed
  generic paths.
- [x] Inbox/IMAP — require `ADMIN` and fail closed until `EmailAccount` has
  reviewed company ownership; do not expose or sync global legacy accounts.
- [x] Telegram — validate webhook authenticity and fail closed until a
  persistent integration-to-company mapping exists; do not execute global task
  reads or writes.

No Invoice, Expense, accounting-export, financial-search, or financial-report
route/model exists in this repository. Pagination exists only in inbox and
Plaid transaction reads; those selectors must be scoped before use.

## Inbox, uploads, and external integrations

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/inbox` | GET | emails | yes | unavailable | ADMIN | C/S | U/X | blocked |
| `/api/inbox` | PATCH | email state | yes | unavailable | ADMIN | C/M | U/X/I | blocked |
| `/api/inbox/accounts` | GET | email credentials metadata | yes | unavailable | ADMIN | C/S | U/X/R | blocked |
| `/api/inbox/accounts` | POST | email credentials | yes | unavailable | ADMIN | M/S | U/X/I/R | blocked |
| `/api/inbox/accounts` | DELETE | account/email tree | yes | unavailable | ADMIN | C/M/S | U/X/I/R | blocked |
| `/api/inbox/sync` | POST | IMAP sync | yes | unavailable | ADMIN | C/M/S | U/X/I/R | blocked |
| `/api/uploads/[...path]` | GET | inspection files | yes | inspection truck | MEMBER | C/S | U/X/I/F | protected |
| `/api/integrations/telegram/webhook` | POST | Telegram/task integration | verified secret | linked company/user | Integration | C/M/S/A | webhook/X/I/G | protected |

Email accounts need additive company ownership. Upload access needs a
database-backed ownership lookup rather than path authorization. Telegram uses
verified webhook authenticity, numeric Telegram identity, explicit FleetPilot
linking, and company-scoped task authorization.

## Integration and repository findings

- QuickManage data originates in a fixed local Playwright scraper that queries
  QuickManage carrier IDs and writes one global JSON cache. The cache payload
  contains external carrier IDs, but neither the script nor FleetPilot schema
  has a verified relation from those IDs to `Company.id`.
- Only `GET /api/qm-stats` reads or refreshes the QuickManage cache; the
  dashboard page calls that route separately from the database-backed
  `/api/dashboard`.
- Safe isolation requires a reviewed unique mapping such as
  `Company.quickManageCarrierId` (or a dedicated integration mapping model),
  plus per-company cache entries keyed by the verified mapping. Reads must
  filter to the active company's entry, and refresh must be role-restricted and
  unable to populate another company's key.
- Until that mapping and cache partitioning exist, `/api/qm-stats` remains a
  production blocker and must not expose its global cached payload in a
  multi-company authenticated deployment.
- Plaid and IMAP credentials are high-sensitivity company resources.
- Local inspection files are retrievable by guessed paths.
- The Telegram webhook performs global task reads, counts, and creates.
- A credential is embedded in an existing QuickManage script. It must be
  rotated immediately and replaced with environment-backed secret management;
  the value must never be copied into issues, logs, commits, or tests.
- The prior generated service worker applied runtime caching to `/api/**`.
  The application now overrides API handling with `NetworkOnly`; the production
  build artifact was inspected to confirm that rule is emitted. Browser cache
  storage is therefore not used for authenticated API responses.

Credential-use audit found multiple standalone QuickManage scripts containing
interactive login logic. Production secret rotation and deployment are outside
this PR. Safe removal requires all operational scripts to read `QM_EMAIL` and
`QM_PASSWORD`, fail when either is absent, remove every literal credential from
Git history where operationally approved, rotate the provider credential, and
restart only after the new environment values are installed.

The audit found 13 QuickManage scripts with embedded login logic. Their values
were not copied into documentation, issues, logs, or tests. Source removal is
deferred because the repository does not yet provide a consistently reviewed
non-production secret mechanism for those standalone scripts; the exact
removal and rotation sequence above is a production rollout blocker.

## Phase 4 validation

- Prisma format, validate, and client generation: pass.
- Local migration status: 18 migrations, schema up to date.
- Local database-to-schema migration diff: empty.
- TypeScript and targeted ESLint for all changed files: pass.
- Unit and integration tests: 53 pass.
- Playwright: 5 pass.
- Production build: pass; generated service worker uses the custom API
  `NetworkOnly` rule.
- `git diff --check`: pass.
- Full repository lint: 224 pre-existing issues (116 errors, 108 warnings);
  changed files are clean.
- Final server-boundary audit: 74 total (73 HTTP handlers plus the public login
  Server Action); no unaudited server entry point.
- Dependency audit baseline: 38 advisories (29 high, 8 moderate, 1 low).
- Dependency audit after remediation: 6 build/lint-only advisories (2 high,
  4 moderate, 0 low), with no reachable production high finding and explicit
  time-bounded acceptances in `docs/Dependency-Advisory-Matrix.md`.

## Remediation order

1. Dashboard and shared aggregation endpoints.
2. Fleet, trucks, loads, settlements, and inspections.
3. Employees, payroll, escrow, reserve, and TM Fund after additive ownership.
4. Finance and Plaid.
5. Inbox and uploads.
6. Telegram and external integrations.
7. Newly discovered company-owned routes and regression audit.

The matrix must be updated from `vulnerable` to `protected` only with linked
tests and completed validation.
