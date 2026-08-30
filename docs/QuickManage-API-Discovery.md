# QuickManage official API discovery

Source: the password-protected QuickManage Apidog project supplied for FleetPilot. Paths below are copied from that official contract. No undocumented endpoint is used.

## Phase 1 fleet contracts

### Trucks-only import prerequisite and identity gate

The first import slice is explicitly `TRUCK`. A preview calls only the official
`POST /x/trucks/search` contract; it does not fetch, stage, or apply trailers,
drivers, customers, payroll, or accounting records. Unsupported resource values
fail before a provider request is made.

The official authentication response documents only `access_token` and `expire`.
The official Users search and `UserInfo` schemas expose user identity but no
trustworthy carrier/company/account identifier or name. Consequently, a valid
token proves connectivity only—it does not prove which QuickManage tenant is
connected. FleetPilot records this as `UNVERIFIED` and blocks apply. It does not
infer identity from truck data, users, names, email domains, or other business
payloads.

The provider-neutral `ExternalProviderAccountMapping` model is the future trust
boundary between an external account and one FleetPilot company. Apply requires
an enabled `VERIFIED` mapping with an external account ID, display name,
verification actor, and verification timestamp. Until QuickManage exposes an
official authoritative account identity (or the vendor supplies an equally
verifiable account identifier), the real import remains **AWAITING VERIFIED
IDENTITY**. Preview remains review-only and writes only staging/audit rows.

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
