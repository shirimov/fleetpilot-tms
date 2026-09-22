# Fuel Deduction Reconciliation

This control compares posted Pilot Diesel and DEF purchases with immutable QuickManage statement evidence. It does not create or change expenses, transactions, expected money, bank matches, receivables, recoveries, allocations, or statement evidence.

## Scope and evidence

- Pilot purchase-date coverage is the minimum and maximum posted event date containing Diesel or DEF. Reefer fuel is reported separately and is not included in expected deductions. Provider invoice adjustments are also reported separately and are never allocated to a Truck.
- QuickManage deductions are accepted only from sealed, accepted archive versions where `sourceArray=fuel_transactions`, `kind=DEDUCTION`, `included` is not false, the normalized amount exists, structured Diesel or DEF is positive, and structured reefer is zero. Missing product metadata, unsupported products, and mixed reefer rows fail closed outside comparable totals. Every result retains the archive version and line IDs.
- The normalized QuickManage metadata contains separate Diesel, DEF, and reefer source fields. The real archive has zero nonzero reefer fields, so there is no evidence that reefer is recovered through these deductions.
- Historical operating Company is resolved at the Pilot purchase date. `Truck.companyId` is never used as historical truth. An uncovered date remains `NEEDS_COMPANY_HISTORY`.
- A statement line can still be linked to a Pilot event while Company history is unresolved. The link preserves timing and the observed amount delta, but expected deduction remains unknown and the status stays `NEEDS_COMPANY_HISTORY`.

## Matching and responsibility

The engine first uses a hashed ticket or authorization reference. If no reference matches, canonical Truck and source purchase date produce candidates, then structured card, merchant/location, city, and state must provide at least two matching identity signals with no conflict. It never matches by amount alone. Weak or ambiguous candidates fail closed as `NEEDS_REVIEW`.

Pilot's XLS can label a Saturday purchase with the following Sunday date while QuickManage retains the immutable Saturday timestamp. This is a provider calendar convention, not a timezone conversion: the observed QuickManage times span many UTC hours while every affected Pilot value is a Sunday date-only value. The fallback therefore accepts only Pilot Sunday to the immediately preceding QuickManage Saturday timestamp, and requires the same historical Company, canonical Truck, recipient, exact card and merchant/location, compatible geography, exact Diesel quantity and DEF amount, and one unique unconsumed candidate. A generic adjacent-day tolerance, date-only QuickManage value, weekday shift, product mismatch, or multiple candidate fails closed.

Structured identity found on another Truck or recipient becomes `NEEDS_RECIPIENT_REVIEW`; it is never reassigned automatically. The six audited cases are source conflicts: five Pilot Truck 7906 purchases were routed by QuickManage to Truck/recipient 8154, and one Pilot Truck 8154 purchase was routed to Truck/recipient 7773. Their exact historical Company and accepted contractor assignments remain distinct, so the evidence does not justify changing master data or economic responsibility.

When the immutable sources identify the same transaction but disagree on Diesel, DEF, or Reefer composition, the result is `PRODUCT_CLASSIFICATION_REVIEW`. The two audited Sunday-boundary cases split one transaction into QuickManage lines that treat Pilot Reefer gallons as Diesel and bundle DEF. The existing Truck 6011 August 1 row has the same product conflict and is no longer reported as a confirmed over-deduction. Exact-day multi-line cases outside this audited shape retain their existing `NEEDS_REVIEW` status.

Identical Driver and Contractor evidence is collapsed to one economic recovery using Company, canonical Truck, provider identity/reference, source date, and exact minor-unit amount. Both archive line IDs remain in evidence and the Contractor recipient is preferred. Company-driver assignments receive a zero expected recipient recovery. Other unresolved recipients remain `NEEDS_RECIPIENT_MAPPING`.

Statement lines whose work period does not overlap imported Pilot coverage are `NO_PILOT_DATA_IMPORTED`. They do not become missing, over-deducted, or statement-only exceptions.

## Effective-dated policy

`FuelDeductionPolicy` is scoped to an Operating Group and Company, with optional canonical Truck and QuickManage recipient scopes. It records responsibility, discount treatment, Company retention basis points, an effective half-open date range, evidence reference, reason, approver, and approval time.

The database rejects overlapping policies at the same exact scope. More specific Truck and recipient policies take precedence over Company-wide policies. If multiple applicable policies have the same highest specificity, resolution fails closed as `NEEDS_REVIEW`. Full pass-through requires zero retention. Company retention uses integer minor-unit arithmetic:

`expected deduction = Pilot net + truncate-to-cents(Pilot discount × retention basis points / 10,000)`

For example, Pilot net of $100.00 with a $20.00 discount and 10% Company retention produces a $102.00 expected deduction, a $2.00 Company-retained discount, and $18.00 of discount benefit passed to the recipient. Missing applicable policy is `NEEDS_POLICY`; the engine does not invent one.

## Statuses

- `MATCHED`, `UNDER_DEDUCTED`, `OVER_DEDUCTED`, and `MISSING_DEDUCTION` compare actual statement deduction with the policy-derived expectation using exact cents and no tolerance.
- `TIMING_DIFFERENCE` identifies one linked recovery deducted outside the purchase work period, avoiding an under/over pair.
- `STATEMENT_ONLY` is limited to unmatched deductions inside imported Pilot coverage.
- `NEEDS_RECIPIENT_REVIEW` and `PRODUCT_CLASSIFICATION_REVIEW` expose deterministic source conflicts without manufacturing a financial conclusion. Their difference is intentionally null.
- `NO_PILOT_DATA_IMPORTED`, `NEEDS_COMPANY_HISTORY`, `NEEDS_TRUCK_MAPPING`, `NEEDS_RECIPIENT_MAPPING`, `NEEDS_POLICY`, and `NEEDS_REVIEW` make missing evidence explicit rather than manufacturing a financial conclusion.

## UI and authorization

Accounting → Statements → Reconciliation provides separate raw and comparable amount cards, status totals, server filtering and pagination, expandable Pilot/statement/policy/timing/identity evidence including historical, posted, and current Company, and an effective-dated policy editor. Policy creation requires active ADMIN or OWNER authority for the Company and writes a `FUEL_DEDUCTION_POLICY_CREATED` financial audit event. Audit Center includes actionable reconciliation queues and excludes `NO_PILOT_DATA_IMPORTED`.

## Read-only Alpha-clone recompute, 2026-09-22

The final branch was evaluated against a fresh private disposable local restore of Alpha. Alpha was accessed only to produce the database dump; no branch code or schema was deployed and no Alpha data changed. Before/after fingerprints for Accounting economics, Pilot records, statement evidence, Truck history, and fuel policies were identical on the disposable copy.

| Measure | Result |
|---|---:|
| Preview runtime / database queries | 0.29 seconds / 23 query events |
| Historical resolver | 698 events in 23 ms / 5 query events |
| Pilot purchase-date coverage | 2026-04-22 through 2026-08-02 |
| Comparable Pilot Diesel + DEF | $399,363.66 |
| Comparable statement fuel inside coverage | $871,596.10 |
| Recovered through corrected linkage | 39 rows / $26,864.43 |
| Confirmed completely unrecovered | 0 rows / $0.00 |
| Confirmed partial under-deduction | 0 rows / $0.00 |
| Confirmed over-deduction | 0 rows / $0.00 |
| Recipient-routing review | 6 rows / $2,539.46 expected |
| Product-classification review | 3 rows / $1,166.83 expected / $1,478.10 observed |
| Needs policy | 120 rows / $63,588.64 Pilot actual |
| Needs structured match review | 87 rows / $55,554.36 Pilot actual |
| Statement-only inside coverage | 791 lines / $377,160.80 |
| Outside Pilot coverage | 1,818 lines / $1,067,265.59 |

`MATCHED` increases from 360 to 399 and `MISSING_DEDUCTION` falls from 47 to zero. The original 47-row audit resolves as 39 matched, six recipient-routing reviews, and two product-classification reviews. Its unresolved exposure remains $3,674.59 and confirmed recovery shortfall is $0.00. The separate pre-existing Truck 6011 August 1 variance is now the third product-classification review: $31.70 expected, $165.50 observed, and a $133.80 variance that is not treated as a confirmed overcharge.

The matcher also attaches 49 Saturday timestamp lines to existing `NEEDS_POLICY` events that satisfy the same strict identity and product rule. Their status and economics do not change. The recompute executes a constant 23 database queries; candidate comparison remains in memory, so the new classification paths add no database N+1 behavior.
