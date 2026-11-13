# Driver-only release delta — October 6, 2026

## R1 recovery verification — October 6, 2026

Recovered the interrupted catalog durability fix by reading its transcript and current source/tests; the implementation was still unchanged and the inherited ancestry tests were RED. Fresh execution reproduced six failures (missing ancestor flushes/rejections), not assumed prior results.

- Changed `src/lib/fleet/driver-safety-catalog.ts`: after JSON fsync/close and rename, independently fsync the catalog directory, storage root and every ancestor through `/`, with directory/no-follow opens and each descriptor closed in `finally`. This also covers directories created by an earlier read. Return success only after all flushes; retain the renamed catalog on uncertainty. Existing lock/cleanup semantics are unchanged.
- Completed `src/lib/fleet/driver-safety-catalog.test.ts`: real-filesystem first-policy/no-attachment coverage for existing and new nested roots; ordered publication, catalog/root/ancestor sync failures, root-open failure, descriptor closure, retained uncertain policy/audit, no attachment writes and unchanged lock/temp cleanup. Ten policy-first cases plus two existing catalog cases. These are bounded fault injections, not power-loss recovery evidence.
- Fresh driver pool/UI/safety run: **40 pass, 0 fail/skip**, rerun successfully after build.
- Fresh `./node_modules/.bin/tsc --noEmit`: exit 0 (no npm typecheck script). ESLint on both modified TS files: exit 0. `git diff --check`: exit 0.
- Fresh `NODE_OPTIONS=--max-old-space-size=2048 npm run build`: exit 0, compilation/TypeScript and 74 static pages complete. Generated PWA artifacts retained in scratch and pre-build PWA bytes restored. Build emitted existing dependency deprecation/stale Browserslist warnings.
- Fresh `npm run lint`: exit 1, **101 errors / 108 warnings**, matching the prior reviewed baseline counts; baseline attribution was not independently re-proven in this recovery. No lint waiver implied.

Recovery evidence: `/home/hermes/.hermes/cache/scratch/driver-r1-recovery-3y6b8yd7/` (`checks.json`, `typecheck.log`, `lint-targeted.log`, `lint-full.log`, `build.log`, `targeted-tests.log`, `build_and_tests.py`, retained `generated-pwa/`). RED results are in this recovery's tool transcript. This report is the only additional release document edited. Build caches were regenerated.

The original source manifest and independent review hashes describe the **pre-R1** payload and are not refreshed or claimed current. The browser prerequisite's approval-blocked before-state hash/status command was not retried, rephrased or recreated; no browser work was attempted. Full-suite DB, Prisma generation/migrations, authenticated/browser, target-filesystem and crash-recovery acceptance were not rerun. No live/SSH/DB provisioning, credentials, fuel or mixed original-worktree edits, deployment, commit or push occurred. Earlier sections below remain historical pre-R1 evidence, not fresh results for the patched payload.

## Outcome and exact scope

Prepared an uncommitted, isolated runnable driver-only delta:

- Worktree: `/home/hermes/projects/fleetpilot-driver-only-20261006`
- Branch: `release/driver-only-20261006`
- HEAD/base: `7b103cf3d6de4ac4327d8d8db2e6dd26ed756a91` — exact supplied last-verified Alpha baseline, present locally. No claim of freshly observed deployed HEAD.
- Source: `/home/hermes/projects/fleetpilot-qm-driver-import`, `feat/qm-driver-import`, HEAD `05cf31143e82efb77bd6999bb133551c666234d1` plus its dirty driver changes.
- Delta: 60 byte-identical transferred source/test/config files, plus a driver-only schema assembled from the Alpha baseline; this report and `DRIVER_ONLY_SOURCE_MANIFEST.json` are release documentation. Four tracked files modified; 59 new files including the two release documents. No commit or staged release is implied.

Includes importer/preview/binding and existing operator preparation scripts/tests, additive source-profile migration, company-scoped pool UI/API, private photo/report catalog and explicit opt-in internal rating, browser fixture/spec, and narrow package test-script/navigation/test changes. No dependency version/lockfile changes. Existing Company creation/mapping scripts are retained source only, not executed operationally.

Excludes every post-baseline fuel/owner change, owner-history migration, source historical reports, source browser test output, and generated PWA artifacts. Baseline fuel functionality is retained, not removed. Build-generated PWA output was preserved in scratch and only this new worktree's PWA files restored to baseline. Source worktree tracked/untracked file hashes and exact Git status were compared before/after and match; no original dirty files were changed. Dependency directory was independently copied, not shared/hard-linked, before client generation.

## Dependency and migration verification

- Alpha baseline: **48 migrations**. Fuel-based source: **50 migrations**. This release: **49 migrations**, exactly baseline 48 plus `20261002120000_driver_source_profiles`.
- Excluded: `20260930090000_truck_owner_history`.
- All baseline migration bytes remain unchanged. All 20 non-schema paths changed between Alpha and fuel heads remain at Alpha bytes or absent if absent at Alpha.
- Semantic schema comparison proves only four added models (`DriverSourceProfile`, `DriverSourceImportEvent`, `DriverSourceCompanyBinding`, `DriverSourceCompanyBindingEvent`) plus ten inverse-relation fields across Company, User, Driver, OperatingGroup and ArchiveCompany. Prisma formatting changes alignment, not other existing schema semantics.
- Traversed 35 files in the local production-driver import graph: no unresolved local import and no dependency on post-baseline fuel paths. Driver SQL uses existing Company/User/membership/group/ArchiveCompany/Driver tables plus new driver tables. Existing archive mapping evidence is read, not manufactured through finance services.
- Fresh real PostgreSQL full-chain migration and actual importer/list/detail acceptance succeeded with both owner-history tables verified absent. This is direct runtime evidence that the exercised driver path does not require the fuel-only schema, not merely a filename assumption.

## Executed checks on this exact worktree

| Check | Actual outcome |
|---|---|
| Normal local Prisma format / validate / generate | All exit 0; generated client 7.9.1 against this driver-only schema |
| Normal Prisma migrate deploy into new private SCRAM cluster | Exit 0; all 49 completed ledger names/checksums equal exact source files |
| `node --import tsx --test scripts/qm-driver-postgres.test.mjs` | Exit 0; 8 pass, 0 fail/skip |
| `NODE_OPTIONS='--import tsx' npm run test:driver-import` with disposable DB | Exit 0; 74 Node + 30 TS/UI/safety pass, 0 fail/skip |
| Company creation Python protocol tests | Exit 0; 12 pass, synthetic only |
| Mapping export Python protocol tests | Exit 0; 9 pass, synthetic only |
| Alpha navigation tests | Exit 0; 2 pass |
| `./node_modules/.bin/tsc --noEmit` | Exit 0; no typecheck npm script exists |
| Targeted ESLint over all transferred JS/TS/application/test paths | Exit 0 |
| `NODE_OPTIONS=--max-old-space-size=2048 npm run build` | Exit 0; compilation, TypeScript and 74-page static generation completed |
| `npm run lint` | Exit 1: 101 errors / 108 warnings; all 23 error-bearing files byte-identical to Alpha baseline; not a waived release exception |
| `git diff --check` and release invariant verifier | Exit 0 |

PostgreSQL tests exercise persisted source/audit readback, replay, full transaction rollback, denied actor, immutable/mapping guards, company-scoped real pool SQL, duplicate concurrency conservation and private CLI apply/replay. Fresh SQL afterward found 6 profiles, 6 import events and 2 bindings, all synthetic. Test authorization contexts are synthetic, not deployed authenticated sessions.

Reused only the previously approved privately extracted PostgreSQL 18 binaries. Adapted a copy of the inspected runner to this exact worktree and new scratch directory, adding exact 49-ledger and absent-owner-table assertions. It created a new cluster/database on a newly selected free loopback high port; no existing database or tunnel was accessed. Shutdown exit 0, pg_ctl status 3, PID absent and listener closed were verified; plaintext password removed. Stopped private scratch data remains. No active acceptance job remains.

Evidence root: `/home/hermes/.hermes/cache/scratch/driver-only-release-20261006/`. PostgreSQL run: `acceptance-bg8vz8tw/`. Other evidence: `typecheck.log`, `lint-targeted.log`, `lint-full.log`, `lint-baseline-proof.json`, `build.log`, `company-python.log`, `mapping-python.log`, `navigation.log`, `source-before.json`, `source-status-before.txt`, `transferred-source-sha256.json`, `release-verification.json`, `run_acceptance.py`, `verify_release.py`.

Full application DB-dependent suite and authenticated/browser tests were not rerun for this release. Prior source-worktree browser evidence is historical, not promoted to exact-release browser acceptance. Parent independent review remains required. Minor scratch-only verification-script parsing errors were corrected (tool-result shape, absent Git paths, lint location parsing); no product fixes, security bypass or fabricated results were used.

## Precise genuine-export mapping hold (no private input access in this pass)

Historical source reports describe 911 scoped driver identities across 14 provider companies; initial genuine preview had zero mapped/insertable drivers because no verified account/group/canonical mapping configuration was supplied. Later historical binding report describes seven existing archive mappings and seven planned Companies plus a successful offline receipt preview. That preview is explicitly `applied:false`, `verified:false`: it is not a durable binding receipt, import-ready configuration or fresh target-state proof. These counts are attributed historical evidence, not fresh private-export validation here.

The missing release input is a **reviewed, complete, target-verified driver import configuration** containing:

1. Exact verified `scope.provider='QUICKMANAGE'`, `scope.accountKey`, `scope.operatingGroupId`, and independently authorized active OWNER `actorUserId`.
2. For every one of the export's provider company identities, an exact tuple `provider, accountKey, operatingGroupId, providerCompanyId, companyId, evidenceReference`. `evidenceReference` must resolve to the exact verified existing ArchiveCompany ID or committed DriverSourceCompanyBinding ID; neither source names nor same-name canonical Companies qualify.
3. For the seven reportedly provisioned Companies, original reviewed fixed-ID plan bytes/hash, successful post-commit creation receipt bytes/hash and exact Company/name/OWNER membership/group revalidation, followed by authorized BIND_PROVISIONED and fresh binding readback. Offline preview does not supply those new binding IDs. For the seven existing mappings, fresh exact archive scope/canonical membership validation is still required.
4. Designated original private export and retrieval/integrity manifest, reconciled against that complete mapping configuration with all unresolved identities left blocked. Original values/bytes must not be trimmed, renamed or synthesized to pass validation.

No canonical IDs, source names, contact/pay data or private export values are printed here. No fake mapping or account identity was created. A missing verified configuration is not proof that target Companies do not exist; do not recreate them on this report's authority.

## Remaining bounded rollout scope

1. Independent review of this exact uncommitted delta and explicit disposition of unchanged lint debt; exact-release authenticated/browser and target-compatible rehearsal where authorized.
2. Reviewed persistent private storage configuration plus inclusion of both safety namespaces in the existing recovery scope; verify auth/readback/retention with the target deployment, without starting a new infrastructure audit project. No actual inspection coverage or live rating policy is supplied; unknowns remain unknown.
3. Separately authorized driver-only app/schema rollout of **one** migration, with exact baseline confirmation and normal migration-ledger verification. Fuel owner-history rollout is not included.
4. Resolve and verify the private mapping inputs above, then separately reviewed authorized operator binding/import invocation and exact persisted source/displayed-field/audit readback/replay. Current `--apply-local` guards remain unchanged and reject live targets; this work did not add a live importer launcher.

No live SSH/DB/Alpha/GitHub/credential access, deployment, real-data import, commit, push or merge occurred.
