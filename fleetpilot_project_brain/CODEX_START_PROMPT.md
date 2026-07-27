# Codex Start Prompt — FleetPilot Activity Engine v1

Read `AGENTS.md`, `docs/Architecture.md`, `docs/Roadmap.md`, and `docs/Sprint-01-Task-Activity-Engine.md`.

Then inspect the repository before changing code.

Your task is to implement Sprint 01 safely.

Important requirements:

- preserve the current Kanban experience
- preserve existing task data
- do not merge into main
- create `feature/activity-engine-v1`
- use Employee relations for new assignments
- temporarily retain legacy `assignedTo`
- centralize task mutations
- write TaskActivity records in the same transaction as task changes
- do not expose secrets
- do not make destructive schema changes without reporting them first

First, return:

1. repository architecture summary
2. relevant task files
3. current task data flow
4. migration risks
5. implementation sequence

After the plan is shown, continue with implementation unless a destructive or ambiguous production-data decision requires approval.

When complete, run all available validation and build commands and provide a truthful completion report.
