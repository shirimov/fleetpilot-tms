# Payroll Audit and Calculation Preview

FleetPilot Payroll Preview is an audit-only calculation foundation. It calculates a deterministic, explainable preview from FleetPilot data and compares it with optional manually entered external statement totals. It does not generate, finalize, settle, pay, or post payroll.

## Current calculation policy

- Company-driver `PER_MILE` contracts are supported.
- Eligible mileage is the existing `Load.miles` value for loads delivered within the pay period (`LOAD_MILES_DELIVERED_IN_PERIOD`).
- Monetary calculations use integer minor units; mileage uses thousandths and deterministic half-up rounding.
- Every trip and adjustment remains visible in the audit trail.
- Missing or unverified inputs are reported as unavailable or blocked rather than converted to zero.
- Team mileage is blocked until an explicit allocation strategy exists.
- Contractor percentage contracts are represented, but calculation is blocked when the percentage base is unknown or unverified.

## External references

QuickManage statement values can be entered manually for comparison. These values are not calculation inputs and are not posted to Accounting. A missing value is distinct from an explicit zero.

The official QuickManage server token receives HTTP 403 from QuickManage's private Payroll web-app endpoints. FleetPilot does not copy browser cookies, automate private sessions, or call those endpoints.

## Explicitly out of scope

- Payroll generation, finalization, locking, settlement, or payment
- Accounting transactions or balance mutations
- ACH, bank transfer, WorkMarket, or QuickManage writes
- Automatic statement import or PDFs
- Automatic driver or contractor balance updates

Before real payroll generation, FleetPilot still needs verified team-mile allocation, empty/deadhead mileage policy, contractor percentage bases and inclusions, authoritative fuel/toll/deduction sources, recurring deduction and escrow semantics, and settlement/payment controls.
