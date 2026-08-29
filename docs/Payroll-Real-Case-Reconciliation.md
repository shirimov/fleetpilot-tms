# Payroll real-case reconciliation (Phase 6D)

Phase 6D is an audit workflow. It does not generate, finalize, settle, lock, or pay payroll; post Accounting entries; mutate balances; or call a private QuickManage Payroll API.

## Current operational state

`AWAITING_REAL_CASES`

No representative real payroll statements are included in the repository and no synthetic fixture is treated as business-rule evidence. An OWNER or authorized ADMIN must enter sanitized values from a known-correct historical statement before any rule can gain matched-case evidence.

## Workflow

1. Select a period and participant whose FleetPilot preview already uses canonical loads, contracts, and adjustments.
2. Record the historical statement reference, optional truck/unit, case type, and known external component values.
3. Classify every input as canonical FleetPilot, manual audit input, external reference, derived, or unavailable.
4. Compare mileage, rate, relevant contractor gross/revenue, base earnings, reimbursements, advances, fuel, tolls, recurring deductions, other deductions, escrow, and payout.
5. Mark a case matched only when every material component is known and exact and the calculation has no blocker. Equal final payout alone is insufficient.
6. Link an exact matched case to a rule before marking an applicable rule admin verified. A not-applicable rule requires an explicit administrator decision and rationale.

Readiness still requires all applicable rules to be configured, administrator verified, tested, reconciled, and supported by case evidence, plus at least three distinct matched representative case types. The gate reports readiness only; generation remains disabled.

## Supported representative case types

- Solo company driver
- Company driver with deductions
- Contractor / owner-operator
- Team driver
- Complex contractor
- Other (for reviewed legacy cases)

Synthetic tests demonstrate deterministic arithmetic and security behavior only. Real cases must establish mileage meaning, team rules, contractor percentage base, deduction treatment, escrow behavior, and advance repayment semantics.
