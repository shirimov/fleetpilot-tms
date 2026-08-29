# Payroll Rule Verification and Reconciliation

Phase 6C extends Payroll Preview with evidence-based rule verification and immutable reconciliation snapshots. It remains audit-only and never enables payroll generation.

## Evidence boundaries

- `Load.miles` is the only current operational mileage field. Its business meaning is not assumed; the default policy remains `LOAD_MILES` and must be verified administratively.
- FleetPilot has no canonical deadhead-mile field and no multi-driver load relation. Deadhead and team calculations therefore remain blocked unless explicit inputs and verified rules are present.
- Fuel and toll Accounting records are not automatically deductible. Payroll treatment requires an explicit reviewed adjustment/rule with attribution and rationale.
- Escrow contribution is shown separately from ordinary deductions. No escrow or financial balance is changed.
- An advance repayment is separate from issuance of an advance. This phase models only an explicit preview deduction.
- QuickManage private Payroll APIs remain unavailable to the server token (HTTP 403). No browser cookie or private-session workaround is used.

## Readiness gate

The readiness dashboard checks mileage, deadhead, team allocation, contractor percentage base, fuel, toll, recurring deductions, escrow, and advance repayment. A rule must be configured, admin verified, tested, and reconciled. At least three matched audit cases are also required before the status can become `READY_FOR_GENERATION_DESIGN`.

That status is permission to design generation—not permission to generate payroll. Generation, finalization, settlement, payment, Accounting posting, balance mutation, statements, and PDFs remain out of scope.
