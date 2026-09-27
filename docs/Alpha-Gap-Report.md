# FleetPilot Internal Alpha — Gap Report

## Readiness verdict

FleetPilot is **not ready to serve as the sole operating system for a full
trucking business day**. It is suitable for a supervised internal pilot of
Task Manager and selected administrative CRUD flows. Authentication,
tenant-isolation, task collaboration, deterministic Kanban movement, and
company-scoped core APIs provide a credible foundation.

The primary constraint is operational depth: the load lifecycle, equipment
model, document chain, communications, accounting close, and production
storage/operations are incomplete or deliberately blocked.

### Scorecard

| Dimension | Assessment | Rationale |
| --- | --- | --- |
| Identity and tenant isolation | Green/amber | Strong primitives; GitHub-only access and legacy null ownership remain |
| Task coordination | Green | Best-developed module; collaboration and audit timeline available |
| Dispatch operations | Red | Basic load CRUD is not a dispatch lifecycle |
| Fleet/safety | Amber/red | Inspections exist; trailers, maintenance, defects, durable files absent |
| Financial control | Red | Settlement/Plaid fragments without ledger, invoices, reconciliation, approvals |
| Communications | Red | Inbox and Telegram intentionally fail-closed |
| Reliability/operations | Red | No approved production rollout, backup/restore drill, monitoring, durable uploads |
| UX/accessibility | Amber/red | Responsive shell exists; many forms are prototype-grade and weakly typed |

## Top 20 Internal Alpha blockers

| Rank | Blocker | Business consequence | Minimum acceptable Alpha outcome |
| ---: | --- | --- | --- |
| 1 | No complete load/stop lifecycle | Dispatch cannot record actual pickup/delivery operations | Load detail with stops, appointments, timestamps, references, status rules |
| 2 | No trailer model or assignment | Equipment plan is incomplete | Trailer CRUD, availability, load/driver/truck relations |
| 3 | No durable private document storage | Rate confirmations, BOL/POD, receipts, inspection photos are unsafe/unreliable | Private object storage, authorization, retention, backup |
| 4 | No load document workflow | Delivery and settlement evidence is missing | Typed load attachments and completeness gate |
| 5 | No dispatch board/exception queue | Dispatchers cannot manage daily work at a glance | Active-load board with late/unassigned/blocked filters |
| 6 | No driver-facing/mobile workflow | Driver events depend on office re-entry | Explicit dispatcher-entry constraint or minimal mobile check-in/inspection/document flow |
| 7 | No equipment availability/conflict validation | Double-assignment and unsafe dispatch remain possible | Date-aware truck/driver/trailer assignment validation |
| 8 | No maintenance/defect lifecycle | Failed inspection does not reliably hold equipment | Defect, out-of-service, repair, release, linked task |
| 9 | Communications intentionally unavailable | Customer and driver messages are outside the record | Company-owned inbox/account model or explicit external-channel operating procedure |
| 10 | No customer/contact model | Loads misuse Company and cannot support shipper/broker contacts | Customer, contact, billing and operating references |
| 11 | Settlement is not an approved ledger | Pay can change without controlled version/approval | Calculated lines, approval lock, attribution, reversal |
| 12 | No invoice/receivable/payment model | Revenue collection cannot be operated | Invoice status, amount due, payment application |
| 13 | No bank reconciliation | Plaid data cannot prove books/cash state | Match bank transactions to payments/expenses with exceptions |
| 14 | Payroll calculation is prototype-grade | Pay risk and disputes | Server-calculated, reviewable, locked payroll run |
| 15 | Reserve/TM Fund ownership missing | Existing fund screens cannot be used safely | Add company ownership or exclude from Alpha |
| 16 | No granular operational permissions | MEMBER can mutate broad task/load state | Role/capability decision and sensitive mutation matrix |
| 17 | No complete audit history outside tasks | Business changes lack traceability | Activity/audit for load, assignment, inspection, settlement, access changes |
| 18 | Legacy null-company data unresolved | Records are hidden and production behavior is uncertain | Inventory, owner-approved mapping, reconciliation migration plan |
| 19 | Production rollout/runbook not proven | A safe release and recovery cannot be assured | Staging rehearsal, migration backup, rollback, restore drill, monitoring |
| 20 | No end-to-end operating-day acceptance test | Completeness claims cannot be verified | Scripted dispatch-to-close scenario with named users and acceptance evidence |

## Missing functionality for one full business day

### Must exist in product

- customer/contact records and a structured load detail
- stops, appointments, actual event times, and dispatch notes
- trailers and date-aware resource assignments
- private documents for rate confirmation, BOL, POD, receipt, and inspection
- active load board plus late, unassigned, missing-document, and equipment-hold
  exceptions
- inspection defects, equipment holds, maintenance action, and release
- controlled settlement calculation/approval
- operational audit trail beyond Task Manager
- end-of-day dashboard and close checklist

### May use an explicit Alpha operating procedure

- dispatcher records events for drivers instead of driver accounts
- email/Telegram remain external if messages are summarized or linked manually
- full payroll and reserve/TM Fund stay out of the launch boundary
- Plaid remains read-only if reconciliation is performed outside FleetPilot
- invoicing remains external if the load stores invoice reference and status

Any workaround must have an owner, entry point, reconciliation step, and
failure escalation. An unavailable screen must be hidden or clearly labeled;
silent empty states are not acceptable.

## Alpha boundary recommendation

Launch the first Alpha around **dispatch coordination**, not “complete TMS”:

- one company
- 3–10 internal office users
- dispatcher-entered driver events
- one-pick/one-drop dry-van loads
- truck, trailer, driver, load, inspection, documents, tasks, settlement status
- no automated money movement
- no Telegram/Inbox/QuickManage until ownership integrations are reviewed

## Estimated effort

Assuming one senior full-stack engineer, product-owner access, and prompt
operational feedback:

| Workstream | Engineer-weeks |
| --- | ---: |
| Workflow discovery, Alpha data/role decisions | 1–2 |
| Load detail, stops, customer/contact, dispatch board | 3–5 |
| Trailer/resource availability and assignment safety | 2–3 |
| Durable private documents and load/inspection attachment flows | 2–3 |
| Defect/maintenance hold workflow and audit | 2–3 |
| Settlement controls and close dashboard | 2–3 |
| UX hardening, error states, accessibility, E2E acceptance | 2–3 |
| Staging rollout, data reconciliation, observability, runbooks | 1–2 |
| **Total** | **15–24 engineer-weeks** |

Two experienced engineers working in parallel with a decisive operator could
target **8–12 calendar weeks**. Adding driver self-service, communications,
full accounting/payroll, or multiple integration rollouts materially expands
that estimate.

