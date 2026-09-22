# Fuel Deduction Reconciliation

This control compares posted Pilot Diesel and DEF purchases with immutable QuickManage statement evidence. It does not create or change expenses, transactions, expected money, bank matches, receivables, recoveries, allocations, or statement evidence.

## Scope and evidence

- Pilot purchase-date coverage is the minimum and maximum posted event date containing Diesel or DEF. Reefer fuel is reported separately and is not included in expected deductions. Provider invoice adjustments are also reported separately and are never allocated to a Truck.
- QuickManage deductions are accepted only from sealed, accepted archive versions where `sourceArray=fuel_transactions`, `kind=DEDUCTION`, `included` is not false, and the normalized amount exists. Every result retains the archive version and line IDs.
- The normalized QuickManage metadata contains separate Diesel, DEF, and reefer source fields. The real archive has zero nonzero reefer fields, so there is no evidence that reefer is recovered through these deductions.
- Historical operating Company is resolved at the Pilot purchase date. `Truck.companyId` is never used as historical truth. An uncovered date remains `NEEDS_COMPANY_HISTORY`.
- A statement line can still be linked to a Pilot event while Company history is unresolved. The link preserves timing and the observed amount delta, but expected deduction remains unknown and the status stays `NEEDS_COMPANY_HISTORY`.

## Matching and responsibility

The engine first uses a hashed ticket or authorization reference. If no reference matches, it accepts a unique canonical Truck plus source purchase date match. It never matches by amount alone. Ambiguous candidates fail closed.

Identical Driver and Contractor evidence is collapsed to one economic recovery using Company, canonical Truck, provider identity/reference, source date, and exact minor-unit amount. Both archive line IDs remain in evidence and the Contractor recipient is preferred. Company-driver assignments receive a zero expected recipient recovery. Other unresolved recipients remain `NEEDS_RECIPIENT_MAPPING`.

Statement lines whose work period does not overlap imported Pilot coverage are `NO_PILOT_DATA_IMPORTED`. They do not become missing, over-deducted, or statement-only exceptions.

## Effective-dated policy

`FuelDeductionPolicy` is scoped to an Operating Group and Company, with optional canonical Truck and QuickManage recipient scopes. It records responsibility, discount treatment, Company retention basis points, an effective half-open date range, evidence reference, reason, approver, and approval time.

The database rejects overlapping policies at the same exact scope. More specific Truck and recipient policies take precedence over Company-wide policies. Full pass-through requires zero retention. Company retention uses integer minor-unit arithmetic:

`expected deduction = Pilot net + truncate-to-cents(Pilot discount × retention basis points / 10,000)`

For example, Pilot net of $100.00 with a $20.00 discount and 10% Company retention produces a $102.00 expected deduction, a $2.00 Company-retained discount, and $18.00 of discount benefit passed to the recipient. Missing applicable policy is `NEEDS_POLICY`; the engine does not invent one.

## Statuses

- `MATCHED`, `UNDER_DEDUCTED`, `OVER_DEDUCTED`, and `MISSING_DEDUCTION` compare actual statement deduction with the policy-derived expectation using exact cents and no tolerance.
- `TIMING_DIFFERENCE` identifies one linked recovery deducted outside the purchase work period, avoiding an under/over pair.
- `STATEMENT_ONLY` is limited to unmatched deductions inside imported Pilot coverage.
- `NO_PILOT_DATA_IMPORTED`, `NEEDS_COMPANY_HISTORY`, `NEEDS_TRUCK_MAPPING`, `NEEDS_RECIPIENT_MAPPING`, `NEEDS_POLICY`, and `NEEDS_REVIEW` make missing evidence explicit rather than manufacturing a financial conclusion.

## UI and authorization

Accounting → Statements → Reconciliation provides coverage and amount cards, status totals, server filtering and pagination, expandable Pilot/statement/policy/timing/identity evidence, and an effective-dated policy editor. Policy creation requires active ADMIN or OWNER authority for the Company and writes a `FUEL_DEDUCTION_POLICY_CREATED` financial audit event. Audit Center includes actionable reconciliation queues and excludes `NO_PILOT_DATA_IMPORTED`.

## Read-only Alpha-clone preview, 2026-09-22

The preview used a private disposable local restore of Alpha, then applied this branch migration locally. No reconciliation code or schema was deployed to Alpha, and no Alpha data was changed.

| Measure | Result |
|---|---:|
| Pilot purchase-date coverage | 2026-04-22 through 2026-08-02 |
| Comparable Diesel + DEF | $399,363.66 |
| Reefer excluded | $10,218.18 |
| Provider credit excluded | -$28.59 |
| Statement deductions inside coverage | $871,596.10 |
| Statement deductions outside coverage | $1,067,265.59 |
| Expected deductions with known policy | $0.00 |
| Pilot amount awaiting policy | $363,654.95 |
| Historical Company unknown | 28 events / $15,956.51 |
| Historical Company differs from posted | 31 events |
| Needs recipient mapping | 30 events / $19,752.20 |
| Needs policy | 618 events / $363,654.95 |
| Statement-only inside coverage | 1,051 lines / $505,742.78 |
| Outside Pilot coverage | 1,818 lines / $1,067,265.59 |

There are no configured fuel deduction policies in Alpha, so the real preview intentionally produces no `MATCHED`, `UNDER_DEDUCTED`, `OVER_DEDUCTED`, `MISSING_DEDUCTION`, or policy-dependent `TIMING_DIFFERENCE` conclusions. Synthetic integration fixtures exercise those calculations, including full pass-through, 10% retention, missing policy, exact/under/over/missing outcomes, paired evidence, Company-driver responsibility, coverage boundaries, and immutable control-only behavior.

The known April 22 Truck 024 purchase links to Turner PID 2026-30 for July 19–25 by canonical Truck/VIN, source date, 135.59 gallons, Pilot card 879856, location 358 in Paducah, Kentucky, and product. Pilot retail is $718.47, net Company expense is $567.48, and savings are $150.99. QuickManage records a $135.89 recipient discount and deducts $582.57. The repeated settlement formula for this Truck and recipient is Pilot net plus the truncated 10% retained share: `$567.48 + truncate($150.99 × 10%) = $582.57`. Because historical Company is uncovered on April 22, its controlling status remains `NEEDS_COMPANY_HISTORY`; no policy is inferred or written, and no current Company fallback is applied.

Private CSV reports generated from the full preview contain Company, Truck, and PID aggregates. They stay outside the repository with the private disposable data.
