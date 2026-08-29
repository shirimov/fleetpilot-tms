# QuickManage official API discovery

Source: the password-protected QuickManage Apidog project supplied for FleetPilot. Paths below are copied from that official contract. No undocumented endpoint is used.

## Phase 2: Trips / Loads

### Verified official Trip contract

`POST /x/trips/search` is the only documented Trip read operation. The body is
`{ query, filters, page, page_size }`; pages are zero-based. It returns
`{ error-fields, message, data: { count, items, page, page_size } }`.

Documented filters include `id`, `number`, `ref_number`, `status`, `po_number`,
`other_number`, `schedule_date`, `delivery_date`, `assigned_truck_ids`,
`assigned_driver_ids`, `assigned_trailer_ids`, `assigned_customer_ids`,
`bill_to_id`, and `booked_by_id`. Date operators are `date_is_on`,
`date_is_after`, `date_is_before`, and `date_between`.

Documented statuses are `upcoming`, `dispatched`, `in_transit`, `canceled`,
`rejected`, and `delivered`. The response supplies Trip UUID, Trip number,
reference/PO/other numbers, customer names/ID, shipment type, hauling rate,
accessorial total, status, stops, file metadata, `created_at`, schedule date,
delivery date, and booked-by metadata. Stops include pickup/delivery direction,
rate/accessorials, distance/deadhead, facility/address, offset-bearing appointment
timestamp, and Truck/Trailer/Driver/Customer assignments.

There is no documented Trip get-by-ID endpoint. Search with the exact `id`
filter is the supported detail lookup. The response does not document or return
`updated_at`, deleted markers, or a changed-since filter. Rate limits are not
documented.

### Redacted live discovery

Alpha read-only discovery returned HTTP 200 and 39 Trips. The provider returned
two items even when `page_size` was 1, so FleetPilot deduplicates by Trip UUID
and fails closed if a page repeats without progress. Exact ID, status, and
schedule-date filters returned HTTP 200. Current status counts were 31 delivered,
7 canceled, 1 rejected, and zero for the other documented statuses. Observed
records contained stops and `created_at`, but not `updated_at`. An observed Truck
assignment resolved through the official Truck search. An observed Driver
assignment did not resolve through the Driver search and must therefore remain
an invalid preview until its Phase 1 identity link exists.

### Files and reports

- `GET /x/files/{id}?type=other|bol|rate-confirmation` downloads a Trip file.
  The official response is described only as `object`; content type, filename,
  size, checksum, expiry, and redirect behavior are not documented, so Phase 2
  records file metadata but does not download or persist files.
- `GET /x/reports?type=&subtype=&page=` lists previously generated reports,
  carrier-scoped, 50 per zero-based page, with `has_more`. It does not generate
  reports. Types include trip, fuel, toll, statement, receivable, 1099,
  adjustment, maintenance, inspection, account-resource variants, and
  driver-perf.
- `GET /x/reports/{id}/content` returns report header data and table
  columns/rows/summary. Report imports remain outside this Trip PR.

### Webhooks

`POST /x/webhook/subscriptions` registers an HTTPS URL for `load.created` and/or
`load.updated`. Its optional secret must be exactly 32 characters; if omitted,
QuickManage creates and returns one. Subscriptions expire after three days and
can be renewed with `POST /x/webhook/subscriptions/{id}/renew`. Official list,
get, delete, and test operations also exist.

The official project does not document the delivery payload, signature header,
signature algorithm/canonicalization, retry policy, duplicate behavior, ordering
guarantees, event ID, or event timestamp. FleetPilot therefore does not register
or process these webhooks in Phase 2. Safe near-live operation requires bounded
reconciliation polling plus explicit preview/apply until the vendor supplies
those security and delivery contracts; one-second polling is not appropriate.

## Phase 1 fleet contracts

All search operations are read-only `POST` requests with a JSON body containing `query`, `filters`, zero-based `page`, and `page_size`. Successful responses use `{ error-fields, message, data: { count, items, page, page_size } }`. The carrier/tenant is derived from the bearer token; no client-supplied carrier ID is accepted.

| Resource | Search | Detail | Search filters | Documented statuses |
| --- | --- | --- | --- | --- |
| Trucks | `POST /x/trucks/search` | `GET /x/trucks/{id}` | `id:eq`, `unit_number:match`, `vin:match`, `plate_number:match` | `active`, `unassigned`, `sold`, `total_loss` |
| Trailers | `POST /x/trailers/search` | `GET /x/trailers/{id}` | `id:eq`, `unit_number:match`, `vin:match`, `plate_number:match` | `active`, `unassigned`, `sold`, `total_loss` |
| Drivers | `POST /x/drivers/search` | `GET /x/drivers/{id}` | ID, name, email and phone matching; date operators for birth, hired, rehired and terminated dates | `active`, `invited`, `terminated` |
| Customers | `POST /x/customers/search` | `GET /x/customers/{id}` | `id:eq`; name, MC number, type and status matching | type: `broker`, `shipper`, `carrier`; search documents status `active` |

Search list items are intentionally narrow. Truck and Trailer lists return ID, unit, VIN, plate number, make, year, status and in-service date. Driver lists return ID, names, dates, email, phone, role, number and status. Customer lists return ID, name, MC number, type and status.

The detail contracts describe richer equipment ownership and relationship fields. During controlled Alpha discovery, valid IDs returned by the search APIs produced `404` from Get Truck, Get Trailer and Get Driver. Get Customer succeeded. Phase 1 therefore uses only the working search schemas and does not infer detail-only values or relationships.

## Phase 2 contracts

### Trips

`POST /x/trips/search` uses the same zero-based page envelope. It supports exact trip number/reference/PO/other-number filters; status `eq`/`in`; pickup and delivery date filters; and assigned Truck, Driver, Trailer and Customer UUID filters. Statuses are `upcoming`, `dispatched`, `in_transit`, `canceled`, `rejected`, and `delivered`.

Trip rows include hauling rate, accessorial totals, stops, distance/deadhead, equipment and driver relationships, customer relationships, attached file IDs/types, schedule/delivery dates, creator and `created_at`. The contract does not document an `updated_at` filter or incremental-change cursor.

### Files

`GET /x/files/{id}?type={type}` downloads trip files. Documented types are `other`, `bol`, and `rate-confirmation`. The response content type/body schema is not documented precisely and must be verified before implementation.

### Reports

- `GET /x/reports?type={type}&subtype={subtype}&page={page}` lists generated reports for the token-bound carrier, 50 per zero-based page, returning `has_more` and report metadata.
- `GET /x/reports/{id}/content` returns header items plus table columns, rows and summary. Legacy XLSX reports are converted on read.

Documented report types: `trip`, `fuel`, `toll`, `statement`, `receivable`, `1099`, `adjustment`, `maintenance`, `inspection`, `account-resource-employee`, `account-resource-site-user`, `account-resource-equipment`, `account-resource-address`, `account-resource-vendor`, `account-resource-customer`, `account-resource-attachment`, and `driver-perf`.

These contracts can support historical accounting discovery, but column semantics are report-defined and must be reconciled before creating FleetPilot financial transactions.

### Webhooks

- `POST /x/webhook/subscriptions` registers an HTTPS URL for `load.created` and/or `load.updated` and accepts an optional exact 32-character secret.
- `GET /x/webhook/subscriptions` lists subscriptions with zero-based page and optional `include_expired`.
- `GET /x/webhook/subscriptions/{id}` reads one subscription.
- `DELETE /x/webhook/subscriptions/{id}` unregisters it.
- `POST /x/webhook/subscriptions/{id}/renew` extends expiry by three days.
- `POST /x/webhook/subscriptions/{id}/test` sends a test delivery.

Subscriptions expire three days after their last update and require renewal. The official pages do not document the signature header/algorithm, delivery payload schema, retry schedule, timeout, ordering, or duplicate-delivery behavior. Webhooks must not be implemented until those security and delivery contracts are supplied.
