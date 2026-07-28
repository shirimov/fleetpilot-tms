# FleetPilot Internal Alpha — Module Inventory

Issue: [#15](https://github.com/shirimov/fleetpilot-tms/issues/15)

Audit baseline: `main` at `2a9299744d96b763c6ec1b1a06513941b17d1a15`.

## Inventory summary

| Surface | Count | Notes |
| --- | ---: | --- |
| Product/platform modules | 16 | Grouped by operating responsibility below |
| Rendered pages | 15 | Includes login and dashboard |
| Navigation destinations | 14 | Dashboard plus 8 primary and 5 HR destinations |
| API route files | 48 | Next.js App Router `route.ts` files |
| Method-level API endpoints | 82 | Includes Auth.js GET and POST handlers |
| Prisma models | 30 | Plus 13 enums |
| Committed migrations | 19 | Additive history through Task Manager 2.1 |

Counts describe code present in `main`, not production deployment state.

## Complete module inventory

| # | Module | Current capability | Completeness | Alpha disposition |
| ---: | --- | --- | --- | --- |
| 1 | Authentication and tenancy | GitHub OAuth, internal users, provider accounts, active-company membership, OWNER/ADMIN/MEMBER roles | Strong foundation | Ready after deployment configuration |
| 2 | Company administration | Company create/list/edit/delete and DOT/MC lookup | Partial | Needs member management and safer onboarding |
| 3 | Dashboard | Company-scoped fleet/load/settlement aggregates and recent loads | Partial | Usable; QuickManage panel is blocked |
| 4 | Dispatch and loads | Load CRUD, status, truck/driver/customer relation, miles and rate | Basic | Missing stops, appointments, documents, exceptions, and dispatch board |
| 5 | Fleet and trucks | Truck CRUD, VIN decode, status, owner-operator flag | Basic | Missing trailers, maintenance, documents, odometer, defects |
| 6 | Drivers | Driver CRUD, pay configuration, truck assignment | Basic | Missing compliance documents, availability, contacts, lifecycle |
| 7 | Safety and inspections | Truck inspections, photos, driver orientation records | Partial | Needs durable storage, defect workflow, signatures, compliance reporting |
| 8 | Settlements | Generate from delivered load/manual entry, deductions, paid state | Partial | Needs accounting controls, exports, immutable approvals |
| 9 | Banking and Plaid | Link institution, scoped accounts, transaction sync/filtering | Partial | Needs reconciliation, token lifecycle, webhooks, audit/runbook |
| 10 | HR and employees | Employee CRUD, roles, salary metadata, payment history | Partial | Needs membership linkage, PII controls, onboarding/offboarding |
| 11 | Payroll | Period calculation, dispatch allocation, payment status | Prototype | Client-heavy calculations and no approval/locking ledger |
| 12 | Escrow and company funds | Employee escrow is scoped; reserve and TM Fund UIs exist | Mixed | Reserve and TM Fund intentionally blocked pending ownership |
| 13 | Task Manager | Kanban/list/filtering, transactional movement, checklist, comments, verified activity | Strongest product module | Suitable for Alpha coordination |
| 14 | Inbox and email | Inbox/account/sync UI and legacy models | Blocked | Intentionally fail-closed pending company ownership |
| 15 | External integrations | Public DOT lookup; Telegram and QuickManage code paths | Mixed | Telegram and QuickManage intentionally fail-closed |
| 16 | Files and platform delivery | Protected inspection download, PWA, tests, Prisma migrations | Partial | Local disk storage and deployment/migration runbooks remain gaps |

## Current navigation map

```text
FleetPilot
├── Dashboard                         /
├── Loads                             /loads
├── Trucks                            /trucks
├── Settlements                       /settlements
├── Tasks                             /tasks
├── Companies                         /companies
├── Inspections                       /inspections
├── Finance                           /finance
├── Inbox                             /inbox
└── HR Department
    ├── Employees                     /hr/employees
    ├── Drivers                       /drivers
    ├── Dispatch Pay                  /hr/dispatch-payroll
    ├── Payroll                       /hr/payroll
    └── TM Fund                       /hr/tmfund
```

The login page (`/login`) is not in navigation. Mobile navigation exposes only
Dashboard, Loads, Trucks, Inspections, Tasks, Employees, and Settlements.

## Page inventory

| Page | Module | Main actions | Readiness |
| --- | --- | --- | --- |
| `/` | Dashboard | KPI cards, QuickManage refresh, quick links, recent loads | Partial; QM unavailable |
| `/login` | Authentication | GitHub sign-in | Foundation-ready |
| `/companies` | Company | List, add, edit, delete, DOT/MC lookup | Partial |
| `/loads` | Dispatch | List, create, edit, delete, assign resources/status | Basic |
| `/trucks` | Fleet | List, VIN decode, create, edit, delete | Basic |
| `/drivers` | Drivers | List, create, edit, delete, assign truck/pay | Basic |
| `/inspections` | Safety | Truck/driver tabs, forms, detail views, photos | Partial |
| `/settlements` | Accounting | Generate, list, mark paid/unpaid, delete | Partial |
| `/finance` | Banking | Connect bank, sync/remove, filter transactions | Partial |
| `/tasks` | Task Manager | Kanban/list, filters, move, drawer collaboration | Strong |
| `/inbox` | Communications | Accounts, sync, filters, message state | UI present; API blocked |
| `/hr/employees` | HR | Employee CRUD, pay, payment history | Partial |
| `/hr/dispatch-payroll` | Payroll | Allocate pool, deductions, escrow, run payroll | Prototype; blocked dependencies |
| `/hr/payroll` | Payroll | Period view, approve, pay, copy/share list | Prototype |
| `/hr/tmfund` | Funds | Balance, regional filters, deposit/expense | UI present; API blocked |

## API inventory

The inventory counts each HTTP method and route pair as one endpoint.

### Authentication, company, and dashboard — 10

| Methods | Route | Status |
| --- | --- | --- |
| GET, POST | `/api/auth/[...nextauth]` | Auth.js protected |
| PATCH | `/api/auth/company` | Protected |
| GET, POST | `/api/companies` | Protected |
| PATCH, DELETE | `/api/companies/[id]` | ADMIN / OWNER |
| GET | `/api/dashboard` | Protected |
| GET | `/api/lookup/dot` | Reviewed public exemption |
| GET | `/api/qm-stats` | Authenticated, fail-closed |

### Fleet, dispatch, safety, and settlements — 26

| Methods | Route | Status |
| --- | --- | --- |
| GET, POST | `/api/trucks` | Protected |
| PATCH, DELETE | `/api/trucks/[id]` | ADMIN |
| GET, POST | `/api/drivers` | Protected / ADMIN mutation |
| PATCH, DELETE | `/api/drivers/[id]` | ADMIN |
| GET, POST | `/api/loads` | Protected |
| PATCH, DELETE | `/api/loads/[id]` | Protected |
| GET, POST | `/api/settlements` | Protected / ADMIN mutation |
| PATCH, DELETE | `/api/settlements/[id]` | ADMIN |
| GET, POST | `/api/inspections/truck` | Protected |
| GET | `/api/inspections/truck/[id]` | Protected |
| GET | `/api/inspections/truck/latest/[truckId]` | Protected |
| POST | `/api/inspections/truck/[id]/photos` | Protected |
| GET, POST | `/api/inspections/driver` | Protected |
| GET | `/api/inspections/driver/[id]` | Protected |
| GET | `/api/inspections/driver/latest-by-truck/[truckId]` | Protected |
| GET | `/api/uploads/[...path]` | Protected inspection files only |

### Workforce and funds — 16

| Methods | Route | Status |
| --- | --- | --- |
| GET, POST | `/api/employees` | ADMIN |
| GET, PUT, DELETE | `/api/employees/[id]` | ADMIN |
| GET, POST | `/api/employees/[id]/payments` | ADMIN |
| PATCH | `/api/employees/[id]/payments/[paymentId]` | ADMIN |
| GET, POST | `/api/escrow` | ADMIN |
| GET, POST | `/api/escrow/[id]` | ADMIN |
| GET, POST | `/api/reserve` | ADMIN, fail-closed |
| GET, POST | `/api/tmfund` | ADMIN, fail-closed |

### Finance — 6

| Methods | Route | Status |
| --- | --- | --- |
| POST | `/api/plaid/create-link-token` | ADMIN |
| POST | `/api/plaid/exchange-token` | ADMIN |
| GET, DELETE | `/api/plaid/accounts` | ADMIN |
| GET, POST | `/api/plaid/transactions` | ADMIN |

### Task Manager — 17

| Methods | Route | Status |
| --- | --- | --- |
| GET, POST | `/api/tasks` | Protected |
| GET | `/api/tasks/projects/[id]/board` | Protected |
| POST, PATCH, DELETE | `/api/tasks/cards` | Protected |
| POST | `/api/tasks/cards/[id]/move` | Protected |
| GET | `/api/tasks/cards/[id]/activity` | Protected |
| GET, POST, PATCH | `/api/tasks/cards/[id]/checklist` | Protected |
| PATCH, DELETE | `/api/tasks/cards/[id]/checklist/[itemId]` | Protected |
| GET, POST | `/api/tasks/cards/[id]/comments` | Protected |
| PATCH, DELETE | `/api/tasks/cards/[id]/comments/[commentId]` | Protected |

### Communications and integrations — 7

| Methods | Route | Status |
| --- | --- | --- |
| GET, PATCH | `/api/inbox` | ADMIN, fail-closed |
| GET, POST, DELETE | `/api/inbox/accounts` | ADMIN, fail-closed |
| POST | `/api/inbox/sync` | ADMIN, fail-closed |
| POST | `/api/telegram/webhook` | Secret-verified, fail-closed |

## Prisma model inventory

| Domain | Models |
| --- | --- |
| Identity/tenancy | `Company`, `User`, `AuthAccount`, `CompanyMembership` |
| Fleet/dispatch | `Truck`, `Driver`, `Load`, `Settlement` |
| Safety | `TruckInspection`, `DriverOrientation` |
| Banking | `BankAccount`, `BankSubAccount`, `BankTransaction` |
| Communications | `EmailAccount`, `Email` |
| Workforce | `Employee`, `EmployeePayment` |
| Funds | `TmFund`, `TmFundTx`, `DispatchReserve`, `EmployeeEscrow`, `EscrowTx` |
| Task Manager | `TaskProject`, `TaskBoard`, `TaskCard`, `TaskLabel`, `TaskComment`, `TaskChecklistItem`, `TaskActivity`, `TaskAttachment` |

### Ownership classification

- Direct company ownership: Company membership, Truck, Load, Driver (nullable
  legacy), BankAccount (nullable legacy), Employee (nullable
  legacy), TaskProject (nullable legacy).
- Verified parent ownership: Settlement through Truck; inspections through
  Truck/Driver; bank children through BankAccount; payments through Employee;
  Task children through TaskProject.
- No trustworthy ownership yet: EmailAccount/Email, TmFund/TmFundTx,
  DispatchReserve.
- Legacy nullable rows are intentionally hidden; they must not be assigned by
  inference.

## Permission matrix

| Capability | Public | Authenticated user | MEMBER | ADMIN | OWNER | Integration |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Sign in / session | — | ✓ | ✓ | ✓ | ✓ | — |
| DOT/MC lookup | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Create company | — | ✓ | ✓ | ✓ | ✓ | — |
| Select active company | — | — | ✓ | ✓ | ✓ | — |
| Read dashboard/tasks/fleet/loads/inspections | — | — | ✓ | ✓ | ✓ | — |
| Mutate tasks/checklists/comments/load workflow | — | — | ✓ | ✓ | ✓ | — |
| Manage trucks/drivers/settlements | — | — | — | ✓ | ✓ | — |
| Manage employees/payroll/escrow/banking | — | — | — | ✓ | ✓ | — |
| Edit company | — | — | — | ✓ | ✓ | — |
| Delete company | — | — | — | — | ✓ | — |
| Process Telegram webhook | — | — | — | — | — | Secret only; company routing blocked |
| Access Inbox, Reserve, TM Fund, QuickManage | — | — | — | Blocked | Blocked | Blocked |

This is a coarse role matrix, not a granular permission system. MEMBER can
currently perform sensitive load and task mutations. Employee records are not
authenticated identities, and employee roles do not grant application access.
