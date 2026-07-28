# Dependency Advisory Matrix

Audit date: 2026-07-28  
Baseline: 38 package-level findings (29 high, 8 moderate, 1 low)  
Remediated result: 6 findings (2 high, 4 moderate, 0 low)

`npm audit` groups one or more GitHub advisories under each affected package.
This matrix accounts for every package-level finding in the baseline report.
Versions are the initially installed versions; “nested” means multiple versions
were present under the named parent.

## Matrix

| Package | Initial version | Severity | Dependency / environment | Vulnerable range and fixed path | Reachability, preconditions, and FleetPilot surface | Breaking risk and disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `@babel/core` | 7.29.0 | Low | Transitive through PWA; build only | `<=7.29.0`; override 7.29.6 | Requires a malicious source-map comment processed during the trusted service-worker build; no request-time path | Patch-compatible override; **fixed now** |
| `@babel/plugin-transform-modules-systemjs` | 7.29.0 | High | Transitive through PWA; build only | `<=7.29.3`; override 7.29.4 | Requires malicious source compiled by Babel; FleetPilot builds committed source only | Patch-compatible override; **fixed now** |
| `@chevrotain/cst-dts-gen` | 10.5.0 | Moderate | Transitive through Prisma CLI; build/deploy tooling | Affected through Gast/Lodash; Prisma 7.9.1 plus Lodash 4.18.1 | No HTTP runtime import; requires malicious Prisma/tooling input | Matched Prisma update; **fixed now** |
| `@chevrotain/gast` | 10.5.0 | Moderate | Transitive through Prisma CLI; build/deploy tooling | Affected through Lodash; override 4.18.1 | No HTTP runtime import; schema is trusted repository input | Low patch risk; **fixed now** |
| `@ducanh2912/next-pwa` | 10.2.9 | Moderate | Direct production install; build-time execution | Audit suggests incompatible downgrade 10.2.6; underlying Workbox remains | Executes only during trusted application build to emit the service worker; no request-body or tenant-data input | Downgrade could regress Next 16 support; **accept temporarily**, see acceptance PWA-001 |
| `@hono/node-server` | 1.19.9 | High | Transitive through Prisma CLI; tooling only | `<=2.0.4`; removed by Prisma 7.9.1 graph | FleetPilot does not run a Hono server; vulnerable static middleware was unreachable | Matched Prisma update; **fixed now** |
| `@mrleebo/prisma-ast` | 0.13.1 | Moderate | Transitive through Prisma CLI; tooling only | `<=0.13.1`; removed by Prisma 7.9.1 graph | Parses trusted Prisma schema during local tooling; no request path | Matched Prisma update; **fixed now** |
| `@prisma/config` | 7.5.0 | High | Transitive through direct Prisma CLI; tooling | vulnerable through affected 7.6 integration range; 7.9.1 | Used for committed Prisma config/schema, not HTTP request processing | Matched minor update; **fixed now** |
| `@prisma/dev` | 0.20.0 | High | Transitive through direct Prisma CLI; tooling | `<=0.24.16`; replaced by Prisma 7.9.1 graph | No production server import; tooling inputs are repository-controlled | Matched minor update; **fixed now** |
| `@rollup/plugin-terser` | 0.4.4 | Moderate | Transitive through PWA; build only | Affected through `serialize-javascript`; no compatible parent fix | Requires attacker-controlled build objects; FleetPilot PWA config is static | Forced serializer major could break Workbox; **accept temporarily**, PWA-001 |
| `axios` | 1.14.0 | High | Transitive through direct Plaid SDK; production runtime | `1.0.0–1.17.0`; override 1.18.0 | Reachable from authenticated ADMIN Plaid routes; attacker would need crafted/prototype-polluted Axios options or redirect/proxy conditions | Same-major override and full Plaid regression tests; **fixed now** |
| `brace-expansion` | 1.1.12 plus nested | High | Transitive through lint/PWA file tooling; development/build | Multiple majors through `<=5.0.7`; no single non-breaking override | Requires a malicious pathological glob/brace expression. FleetPilot scripts and PWA globs are fixed, reviewed strings; impact is build/lint resource exhaustion, not runtime data access | Cross-major override could break glob consumers; **accept temporarily**, BUILD-001 |
| `chevrotain` | 10.5.0 | Moderate | Transitive through Prisma CLI; tooling | Affected through Gast/Lodash; Prisma 7.9.1 plus override | Trusted schema/tooling only; no server entry point | Matched Prisma update; **fixed now** |
| `defu` | 6.1.4 | High | Transitive through Prisma CLI; tooling | `<=6.1.4`; removed by Prisma 7.9.1 graph | Requires malicious defaults object in Prisma tooling; no FleetPilot request path | Matched Prisma update; **fixed now** |
| `effect` | 3.18.4 | High | Transitive through Prisma config; tooling | `<3.20.0`; updated through Prisma 7.9.1 | Async context issue exists in tooling/RPC behavior not used by FleetPilot HTTP authorization | Matched Prisma update; **fixed now** |
| `fast-uri` | 3.1.0 | High | Transitive through validators/build tools | `<=3.1.3`; override 3.1.4 | No direct import; URL validation inputs are tooling/config paths | Patch-compatible override; **fixed now** |
| `follow-redirects` | 1.15.11 | Moderate | Transitive HTTP helper; production install | `<=1.15.11`; override 1.16.0 | Potentially reachable through SDK HTTP calls; callers do not expose arbitrary destination URLs | Same-major override; **fixed now** |
| `form-data` | 4.0.5 | High | Transitive HTTP helper; production install | `4.0.0–4.0.5`; override 4.0.6 | Potentially reachable through SDK multipart handling; no arbitrary form boundary is accepted by Plaid routes | Patch override; **fixed now** |
| `hono` | 4.11.4 | High | Transitive through Prisma CLI; tooling | `<=4.12.26`; removed by Prisma 7.9.1 graph | FleetPilot does not mount Hono, Lambda adapters, JSX, CORS, or static serving | Matched Prisma update; **fixed now** |
| `js-yaml` | 4.1.1 | High | Transitive build/lint tooling | `4.0.0–4.2.0`; override 4.3.0 | Requires malicious YAML merge chains; no request-controlled YAML is parsed | Same-major override; **fixed now** |
| `linkify-it` | 5.0.0 | High | Transitive through unused Mailparser | `<=5.0.1`; removed with Mailparser | Inbox/IMAP handlers are fail closed and no source imported Mailparser | Package removal; **removed** |
| `lodash` | 4.17.21 | High | Transitive PWA/Prisma tooling | `<=4.17.23`; override 4.18.1 | No direct app import; exploit requires malicious template/path operations in build tooling | Same-major override; **fixed now** |
| `mailparser` | 3.9.6 | High | Direct production dependency, unused | `2.1.0–3.9.8`; package removed | No source import remained after inbox was made fail closed; untrusted email parsing was unreachable | Removing unused code is safer than restoring inbox functionality; **removed** |
| `next` | 16.2.12 | High | Direct production runtime/build | Aggregate finding through PostCSS `<=8.5.17` and Sharp `<0.35.0`; overrides 8.5.18/0.35.0 | PostCSS is build-time and Sharp is optional image processing. FleetPilot has no untrusted CSS compiler input and no configured remote image pipeline, but both are production-installed | Transitive patch/minor overrides validated by full build; **fixed now**, Next/Auth architecture unchanged |
| `next-pwa` | 5.6.0 | High | Direct production dependency, unused duplicate | No safe supported audit fix; package removed | Not imported; `next.config.ts` uses only `@ducanh2912/next-pwa` | Removing duplicate cannot change configured behavior; **removed** |
| `node-imap` | 0.9.6 | High | Direct production dependency, unused | All versions affected through Utf7/Semver; no fix; package removed | No source import and all inbox sync routes fail closed | Removing unreachable package is safest; **removed** |
| `nodemailer` | nested under Mailparser | High | Transitive production install, unused | `<=9.0.0`; removed with Mailparser | No mail-send surface and fail-closed inbox never imports it | Parent removal; **removed** |
| `picomatch` | 2.3.1 and 4.0.3 | High | Transitive lint/PWA build tooling | `<2.3.2` and `4.0.0–4.0.3`; scoped overrides 2.3.2/4.0.4 | Glob matching occurs only for trusted source/build patterns, not HTTP input | Patch overrides per major; **fixed now** |
| `postcss` | 8.4.31/8.5.8 | High | Transitive Next/Tailwind; build tooling | `<=8.5.17`; override 8.5.18 | Requires attacker-controlled CSS/source-map comment during build; repository CSS is reviewed | Same-major override; production build passed; **fixed now** |
| `prisma` | 7.5.0 | High | Direct dependency; CLI/tooling | vulnerable through 7.6 integration range; 7.9.1 | Prisma Client runtime was not the affected component; CLI handles trusted config/schema and migrations | Prisma Client/adapter/CLI updated together; **fixed now** |
| `rollup-plugin-terser` | 7.0.2 | High | Transitive through unused legacy `next-pwa`; build | Affected through serializer; removed with duplicate parent | The configured PWA package did not use this copy | Parent removal; **removed** |
| `semver` | vulnerable nested copy under Utf7 | High | Transitive through unused Node-IMAP | `<5.7.2`; removed with Node-IMAP | No reachable IMAP code; exploit requires attacker-controlled version string in legacy dependency | Parent removal; **removed** |
| `serialize-javascript` | 4.0.0/6.0.2 nested | High | Transitive through PWA Terser; build only | `<=7.0.4`; compatible parent does not expose a fixed version | Requires malicious object/prototype behavior passed into Terser serialization. FleetPilot build configuration is static and code-reviewed | Forcing serializer 7 across a `^6` parent is a breaking risk; **accept temporarily**, PWA-001 |
| `sharp` | 0.34.5 | High | Optional transitive Next runtime | `<0.35.0`; override 0.35.0 | FleetPilot does not expose an arbitrary image-transform endpoint or configured remote image source; dependency can still load at runtime | Minor override validated by Next production build; **fixed now** |
| `utf7` | 1.0.2 | High | Transitive through unused Node-IMAP | No fixed Node-IMAP chain; removed | No source import or reachable inbox sync | Parent removal; **removed** |
| `valibot` | 1.2.0 | Moderate | Transitive Prisma tooling | `<=1.4.1`; updated through Prisma 7.9.1 graph | No app runtime import; only trusted Prisma tooling inputs | Matched Prisma update; **fixed now** |
| `workbox-build` | 6.6.0 and 7.1.x | Initially High; now Moderate | Transitive through PWA; build only | Current audit affects 7.1.0–7.4.0 through Terser; no compatible safe parent update | Generates a service worker from static config and committed assets; no request or tenant data enters the build | Removing PWA would remove security NetworkOnly policy; **accept temporarily**, PWA-001 |
| `workbox-webpack-plugin` | 6.6.0 and 7.1.0 | Initially High; now Moderate | Transitive through PWA; build only | Current audit affects 7.1.0–7.4.0; no compatible safe parent update | Invoked only during trusted Webpack production build | Parent downgrade/removal risks Next 16/PWA behavior; **accept temporarily**, PWA-001 |

## Packages changed

- Removed unused: `next-pwa`, `mailparser`, `node-imap`,
  `@types/mailparser`, and `@types/node-imap`.
- Updated together: `prisma`, `@prisma/client`, and `@prisma/adapter-pg`
  from 7.5.0 to 7.9.1.
- Security overrides: Babel Core/SystemJS, Axios, Fast URI,
  Follow Redirects, Form Data, JS-YAML, Lodash, Picomatch, PostCSS, and Sharp.
- Unchanged architecture versions: Next.js 16.2.12, Auth.js
  5.0.0-beta.32, React/React DOM 19.2.3.

## Temporary security acceptances

### PWA-001 — Workbox build chain

- Owner: FleetPilot repository owner / CTO.
- Findings: `@ducanh2912/next-pwa`, `@rollup/plugin-terser`,
  `serialize-javascript`, `workbox-build`, and `workbox-webpack-plugin`.
- Severity remaining: one high package finding and four moderate package
  findings (the high is `serialize-javascript`).
- Reason: the vulnerable chain runs only during trusted production builds.
  Exploitation requires malicious build configuration/source objects or
  prototype manipulation in the build process. No HTTP request, user content,
  company data, webhook body, uploaded file, or environment-derived object is
  passed to Terser/Workbox configuration.
- Compensating controls: protected repository review, deterministic lockfile,
  no arbitrary build plugins/config, generated service-worker inspection,
  and production build validation. Runtime API traffic remains NetworkOnly.
- Follow-up: replace or upgrade the PWA parent when it supports a fixed
  Workbox/Terser chain; retest the generated worker and remove this acceptance.
- Expiry: before accepting untrusted build inputs or 2026-08-31, whichever is
  earlier.

### BUILD-001 — Brace Expansion tooling chain

- Owner: FleetPilot repository owner / CTO.
- Finding: `brace-expansion` (high).
- Reason: affected copies are used by lint/build file matching. Exploitation
  requires a malicious brace/glob expression; FleetPilot scripts and PWA glob
  expressions are fixed repository strings. The impact is CI/local process
  resource exhaustion, with no request-time execution or tenant-data access.
- Compensating controls: code review for package scripts/build configuration,
  bounded CI jobs, deterministic lockfile, and no user-controlled glob input.
- Follow-up: upgrade parent lint/filelist/Workbox packages when their supported
  dependency ranges include fixed Brace Expansion majors.
- Expiry: before exposing glob inputs to users or 2026-08-31, whichever is
  earlier.

## Reachability conclusion

No critical advisory remains. No high-severity advisory remains reachable from
production HTTP requests, authentication/session callbacks, uploads, Plaid
requests, webhooks, Prisma Client queries, or file parsing. The two remaining
high package findings are build/lint-only and explicitly accepted above.

## Compatibility and validation

- Next.js remains 16.2.12; Auth.js remains 5.0.0-beta.32; React and React DOM
  remain 19.2.3. Only one installed copy of each framework package resolves.
- Prisma CLI, Client, and PostgreSQL adapter resolve together at 7.9.1.
- Axios resolves at 1.18.0 under Plaid, PostCSS at 8.5.18 under Next/Tailwind,
  and Sharp at 0.35.0 under Next.
- Removed packages are absent from the final dependency tree.
- Prisma validate/generate/status pass and the database-to-schema diff is empty.
- TypeScript and targeted ESLint pass.
- 53 unit/integration authorization tests and 5 Playwright tests pass.
- The production build passes and emits the API `NetworkOnly` service-worker
  rule.
- Full repository lint remains unchanged at 224 legacy findings (116 errors,
  108 warnings); changed source/config files are clean.
- `git diff --check` passes.

Prisma 7.9.1 supports Node 20.19+, 22.12+, or 24.x according to its package
engine declaration. The local audit used Node 25 and completed successfully,
but production and CI should use a declared supported LTS runtime rather than
relying on an unlisted Node major.
