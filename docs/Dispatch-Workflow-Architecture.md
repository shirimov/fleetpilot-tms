# Dispatch Workflow Internal Alpha

Issue: [#17](https://github.com/shirimov/fleetpilot-tms/issues/17)

## Audit conclusion

`Load` remains the dispatch aggregate. `Company` is the authenticated
FleetPilot tenant/carrier and must not double as a shipper or broker customer.
`Truck`, `Driver`, `Settlement`, Task Manager, and the existing
OWNER/ADMIN/MEMBER authorization foundation remain authoritative.

The legacy load implementation supports basic CRUD with `PENDING`,
`IN_TRANSIT`, `DELIVERED`, and `CANCELLED`, a required truck, an optional
driver, and one origin/destination pair. It has no lifecycle service, resource
conflict protection, trailer, customer/contact, stops, documents, or load
activity history. Settlement ownership is derived through Truck and remains
unchanged.

## Additive design

- Extend `LoadStatus`; do not add a competing workflow-status field. Preserve
  `PENDING` and `CANCELLED` for existing data.
- Relax `Load.truckId` to nullable so a draft may be created before assignment.
  No existing truck relation is removed.
- Add company-owned Customer/CustomerContact and Trailer/TrailerDocument.
- Add ordered LoadStop, typed LoadDocument, and immutable LoadActivity.
- Add nullable customer/trailer relations and notes/invoice number to Load.
- Derive every child’s company through its verified parent. Never accept a
  client company, user, actor, or storage identity as authorization evidence.

## Lifecycle

```text
DRAFT → PLANNED → ASSIGNED → DISPATCHED → PICKED_UP → IN_TRANSIT
      → DELIVERED → POD_UPLOADED → INVOICED → PAID
```

Legacy `PENDING` may move to `PLANNED`. Limited backward/cancellation edges are
explicitly encoded; arbitrary status changes are rejected. Assignment requires
truck, trailer, driver, and an operating window. POD, invoice, and paid states
require a POD document, invoice number, and paid settlement respectively.

## Transactions and conflicts

DispatchService owns load/customer/trailer mutations. Load creation, stop
replacement, assignment validation, status change, and activity creation share
a serializable Prisma transaction.

Active assignment windows reject overlapping use of the same truck, driver, or
trailer. Every related ID is first resolved inside the active company.
Foreign and missing records use the same 404 behavior.

## Documents

Task attachments and dispatch documents share an injectable private-file
storage interface while retaining separate business validation policies. The
filesystem adapter stores opaque UUID keys in isolated `task-attachments` and
`dispatch-documents` namespaces outside `public/`. Set
`PRIVATE_FILE_STORAGE_ROOT` to an absolute path on a persistent mounted volume
for staging.

Only sanitized metadata is returned. Reads occur only after the parent
task/load/trailer is authorized. Download responses use safe
`Content-Disposition`, private/no-store caching, `nosniff`, and a sandboxed
content policy. Retention, backup, and malware-scanning decisions remain
production rollout requirements.

## Permissions

| Capability | MEMBER | ADMIN | OWNER |
| --- | :---: | :---: | :---: |
| Read board/customers/trailers | ✓ | ✓ | ✓ |
| Create/update loads and lifecycle | ✓ | ✓ | ✓ |
| Create/update customers | ✓ | ✓ | ✓ |
| Delete loads/customers/documents | — | ✓ | ✓ |
| Create/update/delete trailers | — | ✓ | ✓ |
| Trailer document mutation | — | ✓ | ✓ |

All actors come from the trusted server session and active membership.

## Migration and rollback

Migration `20260729103000_add_dispatch_workflow_alpha` creates only new
enums/tables/indexes/foreign keys, adds nullable Load fields, extends the
existing enum, changes the new-row default to `DRAFT`, and drops the NOT NULL
constraint from `truckId`. It does not delete or rewrite rows.

Operational rollback is app-first: deploy the prior compatible application and
retain additive schema. A destructive schema rollback is not proposed while
new dispatch records exist.
