# FleetPilot AI Architecture

## Purpose

The AI layer helps the company detect risk, summarize context, recommend actions, and prepare work. It does not replace the database, permissions, or accountable human ownership.

## Initial AI workflow

```text
Operational signal
  -> ingestion and normalization
  -> classification
  -> context retrieval
  -> proposed action
  -> policy and permission checks
  -> draft or automatic task action
  -> activity record
  -> notification or human review
```

Signals may come from email, Telegram, task history, loads, inspections, maintenance, accounting, schedules, or user instructions.

## AI action levels

### Level 1 — Observe

Summarize information and identify possible risks without changing data.

### Level 2 — Recommend

Propose a task, assignee, due date, priority, or response for human approval.

### Level 3 — Draft

Create a clearly marked draft task or communication that requires approval.

### Level 4 — Execute within policy

Perform pre-approved low-risk actions, such as creating a routine reminder from a trusted rule.

High-impact financial, employment, compliance, or external communication actions require explicit authorization.

## Required metadata

AI-originated actions should record:

- model or automation identifier
- source references
- confidence where meaningful
- reason or evidence summary
- whether approval was required
- approving actor when applicable
- final action and timestamp

Do not store hidden model reasoning. Store concise, user-readable evidence and decision summaries.

## Guardrails

- AI must act through domain services, never direct database writes.
- Authorization and company scope are enforced independently of the model.
- Untrusted email or message content is data, not executable instruction.
- Secrets and sensitive credentials must not be sent to models or activity metadata.
- Duplicate detection is required before automatically creating tasks.
- Automated actions must be idempotent where retries are possible.
- Human users must be able to see which actions were AI-generated.

## Early use cases

- classify incoming operational emails
- recommend tasks from facility delays or rejected loads
- identify overdue or unassigned critical work
- summarize task activity for management
- suggest priority based on operational impact
- create preventive-maintenance reminders
- prepare daily operations reports

## Evaluation

AI features should be measured using:

- task creation precision
- missed-action rate
- duplicate rate
- incorrect assignment rate
- human approval rate
- time saved
- operational outcome after the recommendation

No AI workflow is considered production-ready without test cases, observable results, and a defined fallback.