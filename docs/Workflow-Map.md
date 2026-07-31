# FleetPilot Internal Alpha — Daily Workflow Map

This map evaluates whether one dispatcher-led trucking company can operate from
start of day through financial close using FleetPilot as the primary workspace.

## Operating-day map

| Time / event | Owner | Required workflow | FleetPilot today | Gap / fallback |
| --- | --- | --- | --- | --- |
| 06:00 pre-shift | Owner/dispatcher | Review active trucks, drivers, open loads, exceptions, tasks | Dashboard, Trucks, Drivers, Tasks | No unified exception queue, availability, HOS, weather, or unread communication |
| Driver check-in | Dispatcher | Confirm driver/truck/trailer, documents, readiness | Driver/truck assignment; inspections | No trailer model, driver availability, credential expiry, or mobile check-in |
| Pre-trip | Driver/safety | Complete inspection, attach photos, flag defects | Truck inspection and photos | Local-disk storage, no signature, defect severity, repair lockout, or task conversion |
| Load intake | Dispatcher | Capture customer, rate confirmation, stops, appointments, commodity, references | Basic Load CRUD | Customer is a Company; no dedicated customer/contact, multi-stop, appointment, commodity, documents |
| Dispatch assignment | Dispatcher | Match driver, tractor, trailer; communicate dispatch | Load assigns truck/driver | No trailer, availability conflict, assignment history, driver delivery channel |
| Pickup | Driver/dispatcher | Record arrival/departure, BOL, pieces/weight, exception | Status can move to IN_TRANSIT | No stop events, timestamps, BOL/POD attachments, geolocation, detention |
| In transit | Dispatcher | Track ETA, location, delay, HOS, customer update | Manual load status; Task Manager | No tracking, ETA, HOS, alerts, structured exception or communication history |
| Delivery | Driver/dispatcher | Confirm delivery, POD, actual times, accessorials | Status can move to DELIVERED | No POD, stop times, lumper/detention/accessorial evidence |
| Safety exception | Safety/fleet | Create repair/hold, assign work, release equipment | Inspection plus separate Tasks | No explicit inspection-to-task/maintenance relation or out-of-service release |
| Customer update | Dispatcher | Email status and retain correspondence | Inbox UI exists | Inbox/IMAP intentionally unavailable; no customer contact model |
| Settlement prep | Accounting | Select delivered load, calculate driver pay/deductions | Settlement generation | No document completeness gate, approval, rate/accessorial breakdown, immutable version |
| Payroll/escrow | Payroll/admin | Calculate/approve employee pay and escrow | Payroll and escrow screens | Client-heavy calculations; Reserve/TM Fund blocked; no locked payroll run |
| Bank reconciliation | Accounting | Import bank activity and match payments | Plaid account/transaction sync | No reconciliation/matching, ledger, invoice/payment model, exports |
| End-of-day close | Owner | Review unassigned/late loads, defects, cash, tasks; produce report | Dashboard and Tasks | No operational close checklist, exception report, profitability, audit export |

## Workflow handoff map

```text
Customer/load intake
        │
        ▼
Dispatch plan ──► driver + truck assignment ──► pre-trip inspection
        │                                           │
        │                                           ├─ defect ─► maintenance hold/task
        ▼                                           │
Pickup event ──► in-transit monitoring ──► delivery/POD
                                                │
                                                ▼
                                  settlement + payroll approval
                                                │
                                                ▼
                                  bank reconciliation + close
```

FleetPilot stores fragments at each stage, but durable handoffs are absent.
Task Manager can coordinate human follow-up, yet it does not replace structured
load stops, documents, equipment availability, compliance, accounting, or
communications.

## Minimum Alpha workflow

Internal Alpha should intentionally support this narrower path:

1. Admin creates the company, memberships, trucks, drivers, and employees.
2. Dispatcher creates a one-pick/one-drop load with customer/contact,
   appointment times, truck, driver, and trailer.
3. Driver readiness and pre-trip status are verified; defects create a linked
   blocking task.
4. Dispatcher records pickup, in-transit exception, and delivery timestamps.
5. Rate confirmation, BOL, receipts, and POD are stored privately and linked.
6. Delivered load passes a document-completeness gate.
7. Admin approves settlement and records payment status.
8. Owner sees a company-scoped close dashboard listing every open exception.
9. Every significant mutation is attributable and exportable.

## Roles and daily responsibilities

| Role | Alpha-critical views | Alpha-critical decisions |
| --- | --- | --- |
| Owner | Dashboard, cash, loads, exceptions, settlements | Company access, approvals, close |
| Admin | Companies/members, fleet, drivers, payroll, banking | Configuration and sensitive mutations |
| Dispatcher/member | Dispatch board, load detail, tasks, inspections | Assignment, status, exceptions |
| Safety/fleet admin | Inspections, defects, equipment | Hold/release equipment |
| Accounting/admin | Delivered loads, settlements, bank reconciliation | Approve and pay |
| Driver | Mobile assignment, inspection, stop events, documents | Acknowledge and report |

The current application has no driver-facing authenticated role or interface.
For Internal Alpha, driver actions may be entered by a dispatcher only if that
operating constraint is explicit and accepted.

