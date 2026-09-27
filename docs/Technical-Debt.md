# FleetPilot Internal Alpha — Technical Debt and UX Audit

## Technical debt inventory

| Priority | Debt | Evidence / risk | Recommended disposition |
| --- | --- | --- | --- |
| Critical | Embedded QuickManage credentials in standalone scripts | Secret exposure and rotation blocker | Remove from source/history under approved process, rotate, use environment secret |
| Critical | Local filesystem inspection uploads | Ephemeral deployment loss and multi-instance inconsistency | Private object storage adapter and migration |
| High | Missing ownership on EmailAccount, TM Fund, Reserve | Routes must remain fail-closed | Add reviewed company relations and backfill plan only when modules enter scope |
| High | Nullable legacy ownership | Hidden records and uncertain migration state | Inventory and owner-approved reconciliation; never infer |
| High | Prototype financial calculations in client components | Integrity, rounding, replay, and approval risk | Server services, transactions, immutable run/approval models |
| High | Broad MEMBER load/task mutation authority | Insider/error blast radius | Granular capability policy and route tests |
| High | Audit centered on Task Manager only | Operational mutations lack business history | Shared domain activity conventions |
| High | UI uses pervasive `any` and ad hoc response handling | Runtime regressions and silent API errors | Shared DTOs, typed fetch client, error contracts |
| High | Pages mix business rules, fetches, and presentation | Difficult testability and inconsistent rules | Module services/hooks; keep server as authority |
| High | No schema for trailer/customer/stops/documents/maintenance | Core workflow cannot be represented | Add only from approved workflow designs |
| Medium | 15 pages but only a small Playwright suite | UI regressions escape | Critical-path page and permission tests |
| Medium | Full repository lint debt | Quality signal is noisy | Ratchet changed files, then burn down by module |
| Medium | PWA/build-chain advisories | Build-time supply-chain risk | Track accepted advisories and safe parent upgrades |
| Medium | GitHub OAuth only | Operational access/recovery limitation | Decide supported identity providers and break-glass admin |
| Medium | No centralized form/validation framework | Inconsistent input, accessibility, error display | Shared server/client schemas and form primitives |
| Medium | No pagination on large operational lists | Performance degradation | Cursor pagination and indexed filters |
| Medium | Destructive UI actions are basic | Accidental deletion | Confirmation, dependency impact, archive-first patterns |
| Medium | No observability standard | Slow incident diagnosis | Structured logs, request IDs, metrics, error reporting |
| Medium | No documented production data lifecycle | Retention/privacy uncertainty | Classify PII/financial/docs and set retention/deletion policy |
| Low | Emoji navigation and inconsistent visual language | Scan/accessibility/professionalism | Icon system and design tokens after workflow stabilization |

## Dependency position

The current security documentation records six accepted build/lint-chain
advisories (two high, four moderate) and no reachable production high finding.
Maintain the advisory matrix and expiry dates. Do not use forced audit fixes or
unreviewed framework downgrades.

## UI/UX improvement opportunities

### Cross-product

- add an authenticated shell with visible active company and role
- add a company switcher with clear context-change confirmation
- use consistent page headers, primary actions, breadcrumbs, loading skeletons,
  empty states, retry states, and inline errors
- replace `alert`/silent failures with accessible error feedback
- add confirmation and dependency summaries for destructive actions
- keep filter/search state in the URL where useful
- provide keyboard and screen-reader behavior for every dialog/table/action
- simplify mobile navigation; seven equal bottom-navigation items are crowded
- distinguish unavailable, empty, unauthorized, and failed states

### Operations

- prioritize an exception-driven dashboard over decorative totals
- provide a dense dispatch board with saved views and time-zone-aware dates
- use detail drawers/pages rather than overloaded modal forms
- show assignment conflicts before save
- connect inspection defects, loads, tasks, and equipment through visible links
- surface provenance and last-updated time for external data

### Finance and HR

- format money and dates consistently with explicit currency/time zone
- show calculation inputs and approval state
- separate draft, approved, paid, reversed, and failed states
- protect sensitive employee/banking fields from casual list responses
- make exports server-generated, authorized, and auditable

## Architecture decisions needed before Alpha

1. Alpha user/role/capability policy.
2. Trailer, customer/contact, load stop, and document schemas.
3. Durable object storage and malware-scanning stance.
4. Domain-wide activity/audit strategy.
5. Settlement versus accounting system boundary.
6. Driver-facing identity and mobile scope.
7. Legacy ownership reconciliation procedure.
8. Time zone, currency, money precision, and date semantics.
9. Data retention, PII classification, and deletion policy.
10. Monitoring, RTO/RPO, and incident response ownership.

