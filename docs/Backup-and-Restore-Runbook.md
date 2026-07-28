# Backup and Restore Runbook

## Recovery objectives

Initial Internal Alpha targets:

- daily encrypted database and private-attachment backups;
- 14 daily copies on the VPS;
- at least 30 daily copies in a separate off-host account;
- target recovery point objective: 24 hours;
- target recovery time objective: 4 hours after server access is restored.

The off-host destination must not share the VPS root credentials. Backups are
encrypted before leaving the host.

## Backup contents

`scripts/backup-staging.sh` creates:

- PostgreSQL custom-format dump encrypted with age;
- compressed task/dispatch private-volume archive encrypted with age;
- SHA-256 manifest for both encrypted files.

It uses a lock to prevent overlapping jobs, creates no plaintext intermediate
archive, applies restrictive permissions, and removes only recognized backup
filenames older than `BACKUP_RETENTION_DAYS`.

Run manually:

```bash
cd /opt/fleetpilot
ENV_FILE=/opt/fleetpilot/.env.staging \
  ./scripts/backup-staging.sh manual
```

Verify:

```bash
cd /var/backups/fleetpilot
sha256sum --check YYYYMMDDTHHMMSSZ-manual.sha256
```

Copy the `.age` files and manifest to the separate off-host backup account.
Never copy `.env.staging` or the age identity alongside the archives.

## Daily schedule

Create `/etc/cron.d/fleetpilot-backup`:

```cron
17 02 * * * fleetpilot cd /opt/fleetpilot && ENV_FILE=/opt/fleetpilot/.env.staging ./scripts/backup-staging.sh scheduled >> /var/log/fleetpilot-backup.log 2>&1
```

Create `/etc/logrotate.d/fleetpilot-backup`:

```text
/var/log/fleetpilot-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  create 0640 fleetpilot adm
}
```

Monitor for a fresh database archive, attachment archive, and valid manifest
every day. Alert when the newest valid set is older than 30 hours.

## Restore prerequisites

- incident/change approval;
- verified encrypted database backup;
- matching attachment archive when file recovery is required;
- SHA-256 manifest;
- offline age identity copied temporarily to
  `BACKUP_AGE_IDENTITY_FILE` with mode 0600;
- exact application commit compatible with the backup schema;
- a fresh safety backup when the current staging database is readable.

Practice restores on a disposable environment quarterly. Never perform the
first restore rehearsal against the only staging copy.

## Full staging restore

Verify hashes first:

```bash
cd /var/backups/fleetpilot
sha256sum --check BACKUP_PREFIX.sha256
```

Then:

```bash
cd /opt/fleetpilot
RESTORE_CONFIRM=restore-fleetpilot-staging \
ENV_FILE=/opt/fleetpilot/.env.staging \
./scripts/restore-staging.sh \
  /var/backups/fleetpilot/BACKUP_PREFIX-database.dump.age \
  /var/backups/fleetpilot/BACKUP_PREFIX-attachments.tar.gz.age
```

The script stops the app and proxy, restores PostgreSQL with clean/if-exists
semantics, replaces the private volume only when an attachment archive is
provided, reapplies volume permissions, restarts services, and requires the
health endpoint to pass.

This is destructive and intentionally requires the exact
`RESTORE_CONFIRM` value. Do not interrupt it after database restore begins.

## Database-only restore

Omit the second argument only when attachment state is known to be compatible:

```bash
RESTORE_CONFIRM=restore-fleetpilot-staging \
./scripts/restore-staging.sh DATABASE_BACKUP.dump.age
```

Database-only restoration can leave rows referencing newer or missing files.
Run attachment smoke tests before accepting service.

## Post-restore verification

1. Confirm `/api/health` is healthy and reports the intended commit.
2. Confirm Prisma migration status inside the migrator image.
3. Sign in with the staging administrator.
4. Verify active-company selection and dashboard isolation.
5. Download pre-existing task, load, trailer, and POD files.
6. Upload and download a new disposable file.
7. Exercise customer/trailer/load creation and dispatch assignment.
8. Confirm a second company cannot read the restored first-company records.
9. Record backup prefix, application SHA, start/end time, and verifier.
10. Remove the temporary age identity from the server if policy keeps it
    offline.

## Application rollback without data restore

Use the prior exact image/commit when schema changes are backward compatible:

```bash
cat /var/lib/fleetpilot/deployments/previous-image
cd /opt/fleetpilot
git checkout --detach PREVIOUS_40_CHARACTER_SHA
APP_COMMIT_SHA=PREVIOUS_40_CHARACTER_SHA ./scripts/deploy-staging.sh
```

Do not run `prisma migrate reset`, `prisma db push`, or `prisma migrate resolve`.
Do not delete PostgreSQL or attachment volumes during rollback.

## Backup failure handling

- A failed pre-migration backup blocks deployment.
- A failed scheduled backup is an incident after the 30-hour freshness limit.
- Never weaken encryption or write plaintext dumps as a workaround.
- Repair disk capacity, Docker/database health, age recipient configuration, or
  off-host transport, then rerun the backup.
- If the age private identity is lost, rotate to a new key for future backups
  and treat all old archives as unrecoverable.
