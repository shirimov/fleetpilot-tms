# QuickManage financial report audit contract

This document records the official QuickManage report contract and the read-only live discovery performed for FleetPilot Phase 4 on 2026-08-29. No report was generated and no QuickManage or FleetPilot business record was written.

## Official endpoints

- `GET /x/reports?type={type}&subtype={subtype}&page={page}` lists **previously generated** reports belonging to the carrier represented by the access token.
- `GET /x/reports/{id}/content` returns a report only when it belongs to that carrier. It can convert legacy XLSX content when read.
- List pagination is zero-based, fixed at 50 items per page, and exposes `has_more`; it does not expose a total.
- `subtype=ignore` disables subtype filtering. The official documentation does not enumerate subtype values.
- Report metadata can include `id`, `carrier_ids`, `number`, `user`, `type`, `file_id`, `header`, `start_date`, `end_date`, `created_at`, and `updated_at`.
- The content envelope is `data.header`, `data.content.columns`, `data.content.rows`, and optionally `data.content.summary`.
- A column has `cid`, `key`, `description`, and `metadata`. Documented metadata contains `system_name` and `group_name`; the documentation does not define money, currency, scale, aggregation, row-kind, or sign semantics.
- The documented responses are 200, 400, and 404. No report status lifecycle, retention period, rate limit, date query parameter, entity filter, or read-only report-generation endpoint is documented.

The Phase 4 prompt inherited a statement that there are 18 report types. The official `type` enum currently contains **17 exact values**. FleetPilot implements those 17 and does not invent an eighteenth value.

## Exact report-type inventory and live availability

Every type below was queried at page 0 with `subtype=ignore`. The account returned `has_more=false` for every empty type, so there was no undiscovered subsequent page. Only `trip` currently has a previously generated report.

| Official type | Provider meaning verified? | Live data | Findings |
| --- | --- | --- | --- |
| `trip` | Partially | 1 report / 7 rows | Operational trip report; details below. |
| `fuel` | No | None | No fields, units, or transaction semantics can yet be verified. |
| `toll` | No | None | No fields, providers, fees, or relationship semantics can yet be verified. |
| `statement` | No | None | Driver, owner-operator, contractor, company, payroll, and payment meanings remain unknown. |
| `receivable` | No | None | Invoice, balance, aging, paid/outstanding, and load relationship meanings remain unknown. |
| `1099` | No | None | Entity, tax year, reportable amount, and adjustment fields remain unknown. |
| `adjustment` | No | None | Type, entity, effective date, and especially debit/credit sign semantics remain unknown. |
| `maintenance` | No | None | Equipment, service, vendor, cost, mileage, and repair semantics remain unknown. |
| `inspection` | No | None | Equipment, driver, result, cost, and date semantics remain unknown. |
| `account-resource-employee` | No | None | Exact employee account-resource business meaning and fields remain unknown. |
| `account-resource-site-user` | No | None | Exact site-user account-resource business meaning and fields remain unknown. |
| `account-resource-equipment` | No | None | Exact equipment account-resource business meaning and fields remain unknown. |
| `account-resource-address` | No | None | Exact address account-resource business meaning and fields remain unknown. |
| `account-resource-vendor` | No | None | Exact vendor account-resource business meaning and fields remain unknown. |
| `account-resource-customer` | No | None | Exact customer account-resource business meaning and fields remain unknown. |
| `account-resource-attachment` | No | None | Exact attachment account-resource business meaning and fields remain unknown. |
| `driver-perf` | No | None | Operational performance metrics, periods, and entity identifiers remain unknown. |

The empty results are determinable only to this extent: the endpoint lists previously generated reports, `subtype=ignore` was used, page 0 said there was no next page, and this carrier currently returned none. QuickManage may require reports to be generated in its UI. The official project does not document a safe GET generation workflow, expiration, or required date filter, so FleetPilot did not attempt generation.

## Observed Trip report

The one live Trip report used the documented envelope consistently:

- 11 header entries: Company, Filter By, Group By, Trip Stages, Payment Status, Date Range Type, Trip Selection Method, Split Trips between PIDs, Stop Details, From, and To.
- 15 columns: Trip #, Ref #, Customer, Pickup, Delivery, Origin, Destination, Booked By, Empty Mi, Loaded Mi, Total Mi, Rate, RPM, Adjusted Amount, and Adjusted Revenue.
- 7 rows with a mixture of detail/group/subtotal-like shapes.
- Every observed cell was a string. Columns used a generic `data_type=any`; `system_name` and `group_name` were empty.
- No structured `summary` was supplied.
- No canonical Trip, Driver, Truck, Trailer, Customer, or User UUID column was supplied.

Consequences: FleetPilot can preserve and inspect the dynamic rows, but cannot safely decide which rows are line items versus subtotals, interpret monetary units, infer a currency or scale, calculate a financial total, or link by names/numbers. The labels Rate, RPM, Adjusted Amount, and Adjusted Revenue are displayed as vendor terms only.

## Audit safety rules

- Audit input is bounded to 200 columns and 500 rows per fetched report.
- Unknown columns are retained in the sanitized raw view.
- Duplicate full rows and duplicate explicit financial row identifiers are reported.
- Missing canonical relationship IDs are reported only when an exact ID/UUID column exists. Name-only and number-only financial matching is prohibited.
- Exact totals use `BigInt` scaled integers, never floating point.
- A total is calculated only when provider metadata explicitly supplies a monetary/minor-unit precision contract **and** marks the column aggregation as `sum`.
- QuickManage-supplied totals and FleetPilot-calculated totals remain separate, and mismatches are errors.
- Negative values are preserved. Without explicit sign semantics, they produce a warning and are never labeled debit or credit.
- Null means absent for calculation. A value incompatible with an explicit precision contract is an error.
- Reports without explicit financial metadata display `QuickManage semantics not yet verified` and no calculated total.

## Relationships and storage

The report explorer recognizes only exact canonical ID/UUID columns for Trip, Driver, Truck, Trailer, Customer, and User. The current live report exposes none. No cross-resource relationship is forced and no report payload is permanently stored. Requests remain company-authorized, on demand, private/no-store, and server credentialed.

## File contract

Report metadata may expose `file_id`, and the content endpoint may convert legacy XLSX content. The official report documentation does not establish a file download response contract, filename behavior, content type, content length, redirect behavior, or size limit. Phase 4 therefore keeps file references as metadata and does not download files.

## Deferred decisions

- Generate representative statement, fuel, toll, receivable, adjustment, 1099, maintenance, inspection, driver-performance, and each account-resource report in the QuickManage UI before defining typed financial semantics.
- Obtain vendor documentation for currency, precision, row kinds, totals, sign rules, subtype enums, retention/status, rate limits, and file delivery.
- Do not create FleetPilot Accounting, fuel, expense, invoice, payment, settlement, payroll, or tax records until those contracts are verified.
- CSV export is deferred because the current report has no verified financial interpretation and the feature is optional for this phase.
