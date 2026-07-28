# Legacy Route Tenant-Isolation Matrix

Issue: [#10](https://github.com/shirimov/fleetpilot-tms/issues/10)

Audit scope: all 44 App Router API route files (73 exported HTTP handlers),
the login server action, database access outside route handlers, filesystem
upload/download handlers, dashboard aggregation, Plaid, email sync, Telegram,
and QuickManage integration code.

No additional application server actions or route handlers were found outside
this inventory. Client components call these APIs and are not authorization
boundaries.

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

## Dashboard and shared aggregation

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/dashboard` | GET | fleet/load/settlement aggregates | yes | yes | MEMBER | C/A | U/X/G | protected |
| `/api/qm-stats` | GET | QuickManage carrier aggregates/refresh | no | global file | MEMBER; ADMIN refresh | C/M/S/A | U/X/R/G | vulnerable |
| `/api/lookup/dot` | GET | public FMCSA lookup | no | external | public | abuse | validation/rate-limit | exempt |

## Fleet, loads, settlements, and inspections

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/trucks` | GET | trucks | yes | yes | MEMBER | C | U/X | protected |
| `/api/trucks` | POST | truck | yes | yes | ADMIN | M | U/X/I/R | protected |
| `/api/trucks/[id]` | PATCH, DELETE | truck | yes | yes | ADMIN | C/M | U/X/I/R | protected |
| `/api/drivers` | GET | drivers | no | indirect/unscoped | MEMBER | C | U/X | vulnerable |
| `/api/drivers` | POST | driver/truck | no | client truck | ADMIN | M | U/X/I/R | vulnerable |
| `/api/drivers/[id]` | PATCH, DELETE | driver | no | indirect/unscoped | ADMIN | C/M | U/X/I/R | vulnerable |
| `/api/loads` | GET | loads | no | no | MEMBER | C | U/X | vulnerable |
| `/api/loads` | POST | load/relations | no | client company | MEMBER | M | U/X/I | vulnerable |
| `/api/loads/[id]` | PATCH, DELETE | load/relations | no | no/client company | MEMBER | C/M | U/X/I | vulnerable |
| `/api/settlements` | GET | settlements | no | indirect truck/load | MEMBER | C | U/X | vulnerable |
| `/api/settlements` | POST | settlement | no | client relations | ADMIN | M | U/X/I/R | vulnerable |
| `/api/settlements/[id]` | PATCH, DELETE | settlement | no | indirect truck/load | ADMIN | C/M | U/X/I/R | vulnerable |
| `/api/inspections/truck` | GET | truck inspections | yes | parent truck | MEMBER | C | U/X | protected |
| `/api/inspections/truck` | POST | truck inspection | yes | parent truck | MEMBER | M | U/X/I | protected |
| `/api/inspections/truck/[id]` | GET | truck inspection | yes | parent truck | MEMBER | C | U/X | protected |
| `/api/inspections/truck/latest/[truckId]` | GET | truck inspection | yes | parent truck | MEMBER | C | U/X/I | protected |
| `/api/inspections/truck/[id]/photos` | POST | inspection files | yes | parent truck, pre-write | MEMBER | C/M/S | U/X/I/F | protected |
| `/api/inspections/driver` | GET | orientations | yes | driver truck | MEMBER | C | U/X | protected |
| `/api/inspections/driver` | POST | orientation | yes | driver truck | MEMBER | M | U/X/I | protected |
| `/api/inspections/driver/[id]` | GET | orientation | yes | driver truck | MEMBER | C | U/X | protected |
| `/api/inspections/driver/latest-by-truck/[truckId]` | GET | orientation | yes | driver truck | MEMBER | C | U/X/I | protected |

Drivers without a truck have no company ownership in the current schema and
must remain hidden until an explicit ownership relation is added and reviewed.

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

No trailer model, relation, or API handler exists in the current repository.
Trailer authorization cannot be implemented until a separately reviewed data
model and product scope exists; no truck record will be treated as a trailer.

## Employees, payroll, escrow, and company funds

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/employees` | GET | employees | no | no ownership field | MEMBER | C | U/X | vulnerable |
| `/api/employees` | POST | employee | no | no ownership field | ADMIN | M | U/X/I/R | vulnerable |
| `/api/employees/[id]` | GET | employee | no | no ownership field | MEMBER | C | U/X | vulnerable |
| `/api/employees/[id]` | PUT, DELETE | employee | no | no ownership field | ADMIN | C/M | U/X/I/R | vulnerable |
| `/api/employees/[id]/payments` | GET | payroll | no | indirect employee | ADMIN | C | U/X/R | vulnerable |
| `/api/employees/[id]/payments` | POST | payroll | no | client employee | ADMIN | M | U/X/I/R | vulnerable |
| `/api/employees/[id]/payments/[paymentId]` | PATCH | payroll | no | no parent/tenant check | ADMIN | C/M | U/X/I/R | vulnerable |
| `/api/escrow` | GET | employee escrow | no | indirect employee | ADMIN | C | U/X/R | vulnerable |
| `/api/escrow` | POST | employee escrow | no | client employee | ADMIN | M | U/X/I/R | vulnerable |
| `/api/escrow/[id]` | GET | escrow | no | indirect employee | ADMIN | C | U/X/R | vulnerable |
| `/api/escrow/[id]` | POST | escrow transaction | no | indirect employee | ADMIN | M | U/X/I/R | vulnerable |
| `/api/reserve` | GET | dispatch reserve | no | no ownership field | ADMIN | C | U/X/R | vulnerable |
| `/api/reserve` | POST | dispatch reserve | no | no ownership field | ADMIN | M | U/X/I/R | vulnerable |
| `/api/tmfund` | GET | TM fund | no | global first row | ADMIN | C | U/X/R | vulnerable |
| `/api/tmfund` | POST | TM fund transaction | no | global/client employee | ADMIN | M | U/X/I/R | vulnerable |

These models require additive company ownership before safe tenant scoping.

## Plaid and finance integration

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/plaid/create-link-token` | POST | link token | no | no | ADMIN | S/M | U/X/R | vulnerable |
| `/api/plaid/exchange-token` | POST | access token/accounts | no | client company | ADMIN | C/M/S | U/X/I/R | vulnerable |
| `/api/plaid/accounts` | GET | bank accounts | no | no | ADMIN | C/S | U/X/R | vulnerable |
| `/api/plaid/accounts` | DELETE | bank account tree | no | selector only | ADMIN | C/M/S | U/X/I/R | vulnerable |
| `/api/plaid/transactions` | GET | bank transactions | no | partial selector | ADMIN | C/S | U/X/I/R | vulnerable |
| `/api/plaid/transactions` | POST | Plaid sync | no | selector only | ADMIN | C/M/S | U/X/I/R | vulnerable |

Nullable legacy `BankAccount.companyId` rows must remain hidden until ownership
is independently reconciled.

### Finance and integration remediation checklist

- [ ] Settlement list/detail/mutations — scope through `Truck.companyId`; verify
  load, truck, and driver parents before writes; `MEMBER` read, `ADMIN` write.
- [ ] Reserve and TM Fund — require `ADMIN` and fail closed until additive
  company ownership is designed; never return the existing global rows.
- [ ] Plaid link token — authenticated `ADMIN`; no client company selector.
- [ ] Plaid exchange/sync/accounts — `ADMIN`, derive company from membership,
  require non-null `BankAccount.companyId`, and scope every child through it.
- [ ] Upload download — `MEMBER`, allow only inspection paths whose inspection
  resolves through a truck owned by the active company; reject all unindexed
  generic paths.
- [ ] Inbox/IMAP — require `ADMIN` and fail closed until `EmailAccount` has
  reviewed company ownership; do not expose or sync global legacy accounts.
- [ ] Telegram — validate webhook authenticity and fail closed until a
  persistent integration-to-company mapping exists; do not execute global task
  reads or writes.

No Invoice, Expense, accounting-export, financial-search, or financial-report
route/model exists in this repository. Pagination exists only in inbox and
Plaid transaction reads; those selectors must be scoped before use.

## Inbox, uploads, and external integrations

| Route/action | Method | Resource | Auth | Scope | Role | Risk | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/inbox` | GET | emails | no | no ownership field | MEMBER | C/S | U/X | vulnerable |
| `/api/inbox` | PATCH | email state | no | selector only | MEMBER | C/M | U/X/I | vulnerable |
| `/api/inbox/accounts` | GET | email credentials metadata | no | no ownership field | ADMIN | C/S | U/X/R | vulnerable |
| `/api/inbox/accounts` | POST | email credentials | no | no ownership field | ADMIN | M/S | U/X/I/R | vulnerable |
| `/api/inbox/accounts` | DELETE | account/email tree | no | selector only | ADMIN | C/M/S | U/X/I/R | vulnerable |
| `/api/inbox/sync` | POST | IMAP sync | no | selector only | ADMIN | C/M/S | U/X/I/R | vulnerable |
| `/api/uploads/[...path]` | GET | local files | no | path only | MEMBER | C/S | U/X/I/F | vulnerable |
| `/api/telegram/webhook` | POST | Telegram/task integration | no verified webhook | global tasks | Integration | C/M/S/A | webhook/X/I/G | vulnerable |

Email accounts need additive company ownership. Upload access needs a
database-backed ownership lookup rather than path authorization. Telegram needs
verified webhook authenticity and an explicit integration-to-company mapping.

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
- Generated service-worker caching of authenticated API responses must be
  reviewed so one browser session cannot receive another user's cached data.

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
