# Drivers controlled deployment runbook

Prepared on `feature/drivers-ui-redesign`, Draft PR #99. These are operator procedures and example configuration, not a deployment. Do not run against staging/production without explicit approval. Keep external messaging disabled. No infrastructure or production files were accessed during development.

## Release gates

1. Review additive migration `20261025080000_drivers_production_readiness` and test all 49 migrations on a restored disposable database. New scan metadata defaults to **UNSCANNED**; no historical file is assumed clean. Three scoped tables add quarantine scan records, reminder policy and reminder history. Historical versions are retained.
2. Provision a durable private volume outside the repository/public web root, owned by the app service user, directories 0700 and files 0600. Independently verify persistence across container replacement, capacity, host encryption and off-host backup. `DRIVERS_STORAGE_DURABLE=true` is an operator attestation, not mount detection. The code never provisions production storage.
3. Provision ClamAV with current signatures and a service-user-accessible Unix socket. Perform real clean-document and EICAR acceptance tests in approved staging. Local tests use a **protocol simulator**, not antivirus software. No malware-detection effectiveness or installed scanner has been verified.
4. Inventory existing plaintext/unscanned documents before enabling production. Production refuses unscanned downloads and plaintext document reads. Original files/versions remain intact. A reviewed, separately approved historical scanning/encryption migration is required; do not set development mode or loosen download checks to bypass this gate. Administrators may upload a scanned replacement as a new version while preserving the original. No automatic legacy migration or quarantine-release job is installed.
5. Approve carrier-specific required/tracked document types and optional MVR review period. The internal checklist, reminders and human reviews do not establish legal compliance.
6. Exercise coordinated database/document/key backup restoration in an approved environment, confirm least-privilege DB/network access, alert routing, recovery objectives and ownership. Local document restore is verified; a production-scale full PostgreSQL restore/volume failover drill remains an operator gate.

## Environment

Use a service secret store or an owner-only environment file; never commit real values or print keys in logs. Next.js standalone deployment must include generated Prisma client, the worker runtime/dependencies, and the private volume mounted at the same configured location. Worker commands do not automatically source `.env` files.

| Variable                                  | Requirement                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL` | Existing FleetPilot server settings; scoped DB role, approved host and secure session configuration                       |
| `NODE_ENV=production`                     | Enforces private durable storage/encryption and verified clean downloads                                                  |
| `PRIVATE_FILE_STORAGE_ROOT`               | Explicit absolute durable path, e.g. `/srv/fleetpilot-private`; not `public` or a symlinked document namespace            |
| `DRIVERS_STORAGE_DURABLE=true`            | Set only after independent mount/persistence verification                                                                 |
| `DRIVERS_STORAGE_KEYS`                    | Server-only JSON map of key ID to 64 hexadecimal characters (256-bit AES key); retain prior keys for historical envelopes |
| `DRIVERS_STORAGE_ACTIVE_KEY`              | Existing key ID for new AES-256-GCM envelopes; changing it does not rewrite old files                                     |
| `DRIVERS_CLAMD_SOCKET`                    | Absolute local Unix socket path, at most 100 characters. No public TCP scanner transport is supported                     |
| `DRIVERS_REQUIRE_CLEAN_SCAN=true`         | Also enforces clean receipt policy in development/staging; production always requires it                                  |
| `DRIVERS_BACKUP_KEY`                      | Separate 64-hex-character backup encryption key; escrow securely apart from the backup and app keys                       |
| `DRIVERS_OPERATIONS_ENABLED=true`         | Enables explicit company-scoped CLI operations; disabled otherwise                                                        |
| `DRIVERS_REMINDERS_ENABLED=true`          | Global worker gate; per-company policy must also be enabled                                                               |
| `DRIVERS_REMINDER_POLICY_JSON`            | Used only by the explicit policy configuration command below                                                              |

Do not use `NEXT_PUBLIC_` variables for any key. Retain retired storage keys and the backup key used for each historical set. Restore tests must include missing/wrong-key failure. Envelope authentication detects tampering; host disk encryption and access policies remain required. The app never logs private keys, document contents, filenames or scanner signature text in operation summaries.

## Scanner and quarantine

The adapter streams bounded validated bytes over the documented [ClamAV INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), using a 15-second total deadline and bounded response. It accepts only the exact clean response; infected, malformed, disconnected, oversized-response and unavailable scanner outcomes fail closed. A clean protocol response is a scanner receipt, not authenticity verification or a legal qualification decision.

Configure `StreamMaxLength`, `MaxScanSize` and `MaxFileSize` above the 10 MB app upload limit; enable alerts for encrypted/unscannable content, exceeded scan limits and parser errors as appropriate. Use signature updates, signature-age monitoring, socket ownership/permissions and resource limits. Validate the real scanner's archive/encrypted-PDF/limit behavior in staging. Never expose clamd publicly.

Uploads first enter `driver-quarantine`, with a company/driver-scoped scan record and audit. CLEAN uploads may create an active version; development without a scanner records UNSCANNED explicitly, and production without a scanner refuses release. INFECTED/ERROR uploads remain private and create no active version. Quarantine has no HTTP download or public URL. Active files live in `driver-documents`; names are random UUIDs, with authenticated encryption when configured. Existing company/role authorization is rechecked for every download and historical version. Files use no-follow reads, integrity checks and sandbox/no-store download headers. PDF responses always download, and only supported image types may preview inline.

There is no automatic deletion, quarantine release or orphan collection. Scan failure, uncertain DB commit or interrupted write may leave a private orphan; the consistency check reports it for review. Maintain capacity alarms and review retained evidence under an approved retention policy. Do not scan by sending files to a public service.

## Internal reminders and scheduling

There is no general TaskNotification service/model in this branch. Existing Tasks require a board/project and lack a Driver relation. The implementation therefore uses company-scoped DriverReminder records, the existing driver audit timeline and an expandable notification history in the existing Drivers dashboard; it does not create duplicate task boards or alter Task Activity Engine code.

Commands below are examples only; supply an explicitly approved company ID and secret environment. CLI summaries contain counts/status only.

```sh
# Policy changes are explicit, audited per driver and idempotent when unchanged.
DRIVERS_REMINDER_POLICY_JSON='{"enabled":true,"requiredTypes":["CDL_FRONT","CDL_BACK","MEDICAL_CERTIFICATE"],"trackedTypes":["CDL_FRONT","MEDICAL_CERTIFICATE","MVR"],"mvrReviewDays":365}' \
  node --import tsx scripts/drivers-operations.ts configure-policy COMPANY_ID

node --import tsx scripts/drivers-operations.ts reminders COMPANY_ID
node --import tsx scripts/drivers-operations.ts health COMPANY_ID
```

An operator may install a daily systemd timer per approved company after review. Example service settings: `WorkingDirectory=/opt/fleetpilot`, `User=fleetpilot`, `UMask=0077`, `EnvironmentFile=/etc/fleetpilot/drivers-worker.env`, `ExecStart=/usr/bin/node --import tsx scripts/drivers-operations.ts reminders COMPANY_ID`, `NoNewPrivileges=true`, `ProtectSystem=strict`. Pair with `OnCalendar=*-*-* 06:00:00 UTC`, `Persistent=true`, `RandomizedDelaySec=300`. Adjust paths/runtime for the actual host; no service/timer was installed or scheduled here.

The worker pages drivers in batches of 100, checks only configured types and current versions, and computes UTC date thresholds. MVR review due date may derive from issue date plus the explicitly configured interval; the earliest recorded expiration/review date wins. A late run catches up to the nearest 90/60/30/expired stage rather than flooding all skipped stages. Each current-version/stage or missing-type/policy-revision event has a unique deduplication key. Concurrent/retried workers create one history record and one audit per event in a transaction. Unchanged policy configuration does not create a new revision. Updated/disabled policy is checked under a row lock before inserting each event.

The dashboard explicitly labels history as historical: an old alert may have been resolved by a replacement. No email, SMS, Telegram delivery or provider calls exist in this worker. Enabling those existing global integrations cannot enable Drivers external reminders. External delivery would require a separate reviewed implementation and approval. Disabling the worker gates stops new history creation while preserving records.

## Backup, restore and consistency

Take a coordinated full PostgreSQL dump and private-document backup during an approved write-maintenance window: pause uploads/edits and reminder workers, complete both backups and record migration/app versions, then resume. Database backups remain part of the existing infrastructure; do not replace or modify Fuel/Accounting backup jobs. Document backups contain a repeatable-read metadata snapshot and every referenced active/quarantine blob for the explicit company, including historical versions. They are supplemental to a full PostgreSQL dump, not a replacement for it.

```sh
# Each destination must be new, absolute and outside public web storage.
node --import tsx scripts/drivers-operations.ts backup COMPANY_ID /secure-backups/NEW_SET
node --import tsx scripts/drivers-operations.ts restore COMPANY_ID /secure-backups/NEW_SET /private-recovery/NEW_ROOT
node --import tsx scripts/drivers-operations.ts health COMPANY_ID
```

Backups encrypt each artifact plus its metadata manifest with the separate backup key. A completion marker is written only after all artifacts; hashes and authenticated decryption validate every artifact before recovery begins. Recovery rejects wrong company, corrupt/incomplete sets, unsafe paths and existing destinations. It reconstructs original file bytes into a new private root and writes an owner-only `document-metadata.json` for comparing the coordinated database restore. It never overwrites active files or modifies the database. Partial backup/recovery destinations must remain private and be reviewed; no automatic pruning occurs.

Restore the coordinated full DB into a **new isolated instance** using existing approved PostgreSQL procedures, restore the matching keys/files, compare metadata to restored DB versions, then point a disposable app at the recovery root. Verify old/current downloads, scan gates, company isolation and audit history before any approved cutover. Do not import the metadata JSON blindly or run destructive reset against an existing database.

Health checks decrypt/hash every scoped referenced version and quarantine file, detect missing/corrupt/unreadable files and report global namespace orphan counts without attributing them to the selected company. They also check key configuration, directory access and scanner response. The CLI exits nonzero on missing/corrupt storage or a non-clean production scanner probe. It never returns file contents through an HTTP health endpoint and never deletes orphans. A lost file is recovered from the matching backup to a new root first; a corrupt active file is not silently repaired.

Encrypted document backups cover DB-referenced files, not unreferenced orphans. Preserve a separately encrypted durable-volume snapshot if retained orphan evidence must be recovered. Retain full coordinated sets and key escrow according to approved carrier/legal policy. Test off-host backup availability and recovery-time objectives regularly. No retention duration is invented in code.

## Monitoring, failure handling and rollback

Backup metadata is capped at 127 MB per company/set so every completed manifest fits the bounded recovery reader. Oversized sets fail without a completion marker. Include metadata volume and memory use in the production-scale drill before enabling backups for a large archive. Missing/corrupt counters count distinct physical files, while version and scan counters count database rows.

- Alert on worker command failure, per-company `lastFailureAt`, stale `lastSuccessAt`, scanner downtime/signature age, disk capacity, backup age and nonzero missing/corrupt/orphan counts. Alert routing is an operator prerequisite; no real messaging was configured here.
- Scanner errors keep uploads quarantined and return 503; infected uploads return 400. Existing versions remain intact. Restore scanner availability before retrying; do not toggle security checks off.
- Missing encryption keys or legacy plaintext cause access failures; recover approved keys or perform the separately reviewed migration. Never log keys/contents during investigation.
- Stop timers and disable reminder policy/global gate to pause automation. Do not delete reminder/audit history to suppress errors.
- Migrations are additive; do not drop new tables/columns or roll back database history. Take coordinated backups before release. Rolling the app back to Phase 2 would bypass scan/encryption enforcement and cannot read new encrypted files correctly; use maintenance mode and a reviewed forward fix or restore the entire coordinated pre-release environment. Do not point old application code at newly encrypted storage.
- No merge, deployment, staging access or infrastructure change is authorized by this runbook. Request approval before accessing real staging/production systems or migrating real historical files.
