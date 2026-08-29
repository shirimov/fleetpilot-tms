# QuickManage report capture and import preparation

Phase 5 prepares FleetPilot to inspect representative reports that an administrator generates manually in the normal QuickManage UI. It does not generate reports, mirror report payloads, or create canonical FleetPilot business data.

## Current representative samples

The read-only discovery performed on 2026-08-29 found one generated `trip` report. Page zero for each of the other 16 official types returned zero items and `has_more=false`.

| Type | Current readiness | Required manual sample |
| --- | --- | --- |
| `trip` | `BLOCKED` | Existing sample is structurally inspectable, but has mixed row shapes, no canonical IDs, and no money/sign contract. Generate a second Trip report with the same settings and a deliberately different date range to test stability. |
| `fuel` | `NOT_AVAILABLE` | Generate one detailed fuel transaction report containing positive, negative/credit, zero, and blank cases if the UI permits. |
| `toll` | `NOT_AVAILABLE` | Generate one detailed toll transaction report across at least two trucks and include any fees/credits if available. |
| `statement` | `NOT_AVAILABLE` | Generate one representative driver statement and one owner-operator/contractor statement separately if QuickManage offers both. Include revenue, deductions, advances, reimbursements, and adjustments where legitimately present. |
| `receivable` | `NOT_AVAILABLE` | Generate one open/partially-paid receivable report and one paid report if the UI separates them. |
| `1099` | `NOT_AVAILABLE` | Generate one report for a closed tax year using non-production display/export controls only. |
| `adjustment` | `NOT_AVAILABLE` | Generate one report that naturally contains both positive and negative adjustments, without creating artificial accounting activity. |
| `maintenance` | `NOT_AVAILABLE` | Generate one detailed maintenance-cost report with equipment and vendor fields where available. |
| `inspection` | `NOT_AVAILABLE` | Generate one inspection report with equipment/driver relationships where available. |
| `account-resource-employee` | `NOT_AVAILABLE` | Generate the Employee account-resource report exactly as named in QuickManage. |
| `account-resource-site-user` | `NOT_AVAILABLE` | Generate the Site User account-resource report exactly as named. |
| `account-resource-equipment` | `NOT_AVAILABLE` | Generate the Equipment account-resource report exactly as named. |
| `account-resource-address` | `NOT_AVAILABLE` | Generate the Address account-resource report exactly as named. |
| `account-resource-vendor` | `NOT_AVAILABLE` | Generate the Vendor account-resource report exactly as named. |
| `account-resource-customer` | `NOT_AVAILABLE` | Generate the Customer account-resource report exactly as named. |
| `account-resource-attachment` | `NOT_AVAILABLE` | Generate the Attachment account-resource report exactly as named. |
| `driver-perf` | `NOT_AVAILABLE` | Generate one driver-performance report covering multiple drivers and a bounded date range. |

Do not create synthetic loads, financial transactions, statements, adjustments, or expenses merely to populate a report. Use representative history that already exists.

## Capture lifecycle

The dashboard scans only page zero (`subtype=ignore`) for each of the 17 documented types. It reports the number on that page and marks the count as a lower bound if `has_more=true`. It never claims a vendor-wide total that the API does not supply.

When an administrator opens report content, FleetPilot calculates a SHA-256 structure fingerprint from:

- parser version;
- exact report type and subtype;
- stable content-envelope shape;
- ordered provider column names;
- provider-declared types, system names, and group names.

The fingerprint excludes header values, row values, amounts, names, identifiers, and other business content. A parser-version change intentionally changes the fingerprint. During one browser exploration session, a new fingerprint for the same type displays `STRUCTURE CHANGED` and blocks mapping reuse.

Complete response payloads remain transient and are returned with `Cache-Control: private, no-store`. Session review choices are not persisted and cannot enable an import.

## Classification and readiness

The capture layer supports `IDENTIFIER`, `DATE`, `DATETIME`, `TEXT`, `STATUS`, `RELATIONSHIP_ID`, `MONEY`, `QUANTITY`, `RATE`, `PERCENT`, `BOOLEAN`, and `UNKNOWN`.

- Exact canonical `Trip/Driver/Truck/Trailer/Customer/User ID|UUID` columns may be observed as relationships.
- Explicit provider date, datetime, boolean, text, and monetary declarations may be vendor-verified.
- A numeric value or money-like column label never makes a field canonical money. It remains `UNKNOWN`; a possible classification is displayed only as a suggestion.
- Name-only financial relationships are prohibited.

`READY_FOR_IMPORT_DESIGN` requires a structure fingerprint, a reviewed idempotency identifier, understood canonical relationships, reviewed fields, reviewed accounting concepts, and complete monetary contracts. This is a design gate only; no import endpoint exists.

A complete money contract requires currency, major/minor-unit representation, decimal precision, positive meaning, negative meaning, null meaning, and zero meaning. Missing information yields `MONEY_CONTRACT_UNVERIFIED`. Arithmetic continues to use scaled integers/`BigInt`, never floating point.

## Current reconstruction/import previews

- Statement reconstruction: `RECONSTRUCTION NOT VERIFIED`; no sample exists.
- Fuel preview: unavailable; no sample exists.
- Toll preview: unavailable; no sample exists.
- Adjustment preview: unavailable; no sample exists and debit/credit sign behavior is unknown.
- Receivable preview: unavailable; no sample exists.
- Trip financial interpretation: partial structure only; no safe calculated monetary total or financial-row-to-Trip relationship is available.

## File contract recheck

The official QuickManage page for `GET /x/files/{id}` was rechecked on 2026-08-29. It describes downloading Trip files and its example uses `?type=bol`. The official project also identifies `other`, `bol`, and `rate-confirmation` as supported type values.

The 200 response is still displayed as `application/json` with an empty `{}` example. It does not document response headers, binary versus JSON/redirect behavior, filename derivation, content length, maximum size, streaming/range behavior, or detailed errors. FleetPilot therefore remains metadata-only and does not call or implement file downloads in Phase 5.

## Security and write boundary

- The existing administration module policy remains authoritative: OWNER/ADMIN only; MEMBER denied server-side.
- Every request uses the active company context, server credentials, sanitized errors/data, and no-store responses.
- Catalog reads use only documented report-list GETs; content uses only the documented content GET.
- No QuickManage report-generation, file-download, mutation, webhook, or subscription endpoint is called.
- No FleetPilot Accounting transaction, fuel transaction, expense, toll, payment, settlement, payroll, statement, invoice, receivable, or maintenance expense is created or modified.
