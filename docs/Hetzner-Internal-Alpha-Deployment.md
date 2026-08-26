# Hetzner Internal Alpha Deployment

## Purpose and boundary

This runbook prepares a private, production-style staging environment. It does
not authorize a production deployment. The release must be built from an exact
Git commit, backed up before migration, migrated once through the release
container, and health-checked before acceptance.

## Recommended server

- Ubuntu 24.04 LTS, x86-64
- 4 dedicated or shared vCPU
- 8 GB RAM
- 160 GB NVMe system disk
- 2 GB swap for build headroom
- Hetzner volume or equivalent capacity sized for attachment growth
- encrypted off-host backup destination, preferably a separate Storage Box

The minimum practical alpha size is 2 vCPU, 4 GB RAM, and 80 GB disk, but local
Next.js image builds and PostgreSQL maintenance have little safety margin there.

Only TCP 22 (restricted administration), TCP 80, TCP 443, and UDP 443 are
needed. PostgreSQL has no published host port.

## DNS and OAuth prerequisites

Create an `A` record:

```text
alpha.example.com  A  HETZNER_SERVER_IPV4
```

Create an `AAAA` record only if IPv6 is configured and firewalled. Caddy
requires the hostname to resolve to the VPS and external access to ports 80 and
443 for automatic HTTPS. See the
[Caddy HTTPS prerequisites](https://caddyserver.com/docs/quick-starts/https).

Create a separate GitHub OAuth application:

```text
Homepage URL:              https://alpha.example.com
Authorization callback:   https://alpha.example.com/api/auth/callback/github
```

Use a verified primary GitHub email for the bootstrap administrator.

## Required staging variables

Copy `.env.staging.example` to `.env.staging` and replace every placeholder.
The required groups are:

- release: `APP_COMMIT_SHA`, `FLEETPILOT_IMAGE_REPOSITORY`
- public URL/TLS: `STAGING_DOMAIN`, `APP_URL`, `CADDY_EMAIL`
- database: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`
- Auth.js: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
- private files: `PRIVATE_FILE_STORAGE_ROOT`
- bootstrap: `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`,
  `BOOTSTRAP_COMPANY_NAME`
- backups: `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`,
  `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY_FILE`
- release state: `DEPLOY_STATE_DIR`

`DATABASE_URL` uses the Compose hostname `db`, never a public address.
`PRIVATE_FILE_STORAGE_ROOT` must be the absolute in-container mounted path
`/var/lib/fleetpilot/private`.

## Fresh Ubuntu server

Run as an administrator with `sudo`. Replace account, domain, repository
access, and commit placeholders deliberately.

### 1. Patch and firewall the host

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git age ufw
sudo timedatectl set-timezone UTC

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status verbose
```

Docker-published ports can bypass some UFW forwarding rules. This Compose file
publishes only 80/443; verify that invariant after every configuration change.
Docker documents the firewall interaction in its
[Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/).

### 2. Install Docker from its official repository

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

These commands follow Docker's
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).

### 3. Create the deployment operator

```bash
sudo adduser --disabled-password --gecos "" fleetpilot
sudo usermod -aG docker fleetpilot
sudo install -d -o fleetpilot -g fleetpilot -m 0750 /opt/fleetpilot
sudo install -d -o fleetpilot -g fleetpilot -m 0700 \
  /var/lib/fleetpilot/deployments /var/backups/fleetpilot
sudo install -d -o root -g root -m 0700 /etc/fleetpilot
```

Membership in the Docker group is root-equivalent. Restrict this account's SSH
key and do not use it for ordinary interactive work.

### 4. Check out an exact release

Configure a read-only repository deploy key, then:

```bash
sudo -iu fleetpilot
git clone git@github.com:shirimov/fleetpilot-tms.git /opt/fleetpilot
cd /opt/fleetpilot
git fetch --prune origin
git checkout --detach FULL_40_CHARACTER_COMMIT_SHA
test "$(git rev-parse HEAD)" = "FULL_40_CHARACTER_COMMIT_SHA"
```

### 5. Create secrets and backup encryption

Generate secrets locally or on the server without committing them:

```bash
cd /opt/fleetpilot
install -m 0600 .env.staging.example .env.staging
openssl rand -base64 48
age-keygen -o /tmp/fleetpilot-backup-age-key.txt
sudo install -o root -g root -m 0600 /tmp/fleetpilot-backup-age-key.txt \
  /etc/fleetpilot/backup-age-key.txt
sudo shred -u /tmp/fleetpilot-backup-age-key.txt
```

Record the printed age public recipient in `BACKUP_AGE_RECIPIENT`. Store an
offline copy of the private age identity; loss of it makes backups
unrecoverable. Edit `.env.staging`, set the exact commit, and confirm:

```bash
chmod 0600 .env.staging
grep -n 'CHANGE_ME' .env.staging
docker compose --env-file .env.staging \
  -f docker-compose.staging.yml config --quiet
```

The `grep` command must return no placeholder values.

### Telegram staging bot configuration

Internal Alpha uses a staging-only Telegram bot. Do not reuse the production bot.

Add these environment variables to `.env.staging` without committing real values:

```bash
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_BOT_USERNAME=
QUICKMANAGE_CLIENT_ID=
QUICKMANAGE_CLIENT_SECRET=
QUICKMANAGE_API_BASE_URL=https://api.quickmanage.com
```

Setup flow:

1. Create a dedicated staging bot with BotFather.
2. Record the bot token in `TELEGRAM_BOT_TOKEN`.
3. Generate a long random `TELEGRAM_WEBHOOK_SECRET`.
4. Set `TELEGRAM_BOT_USERNAME` to the bot username without the `@`.
5. Enable the integration by setting `TELEGRAM_ENABLED=true`.
6. Point Telegram at the Alpha webhook:

```bash
curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://alpha.example.com/api/integrations/telegram/webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

Verify the webhook:

```bash
curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Rotation / disable:

- rotate by issuing a new BotFather token, updating `.env.staging`, and resetting the webhook;
- disable by setting `TELEGRAM_ENABLED=false` and redeploying;
- if rollback is required, redeploy the previous application image and keep the staging bot/token separate from production.

### 6. First controlled release

After the DNS record resolves and the OAuth callback is configured:

```bash
cd /opt/fleetpilot
APP_COMMIT_SHA=FULL_40_CHARACTER_COMMIT_SHA ./scripts/deploy-staging.sh
```

The script:

1. rejects a dirty or mismatched checkout;
2. builds commit-addressed app and migrator images;
3. starts only PostgreSQL and private-volume initialization;
4. creates encrypted database and attachment backups;
5. requires both archives, their valid checksum manifest, and a completion
   marker before continuing;
6. runs `prisma migrate deploy` once in the migrator container;
7. refuses to start the release if migration fails;
8. starts the application and Caddy;
9. verifies `/api/health` reports the requested commit;
10. retains and records the previous image for rollback.

Migrations are not part of normal web-container startup.

The private file volume is initialized as UID/GID `1001:1001`, mode `0700`.
The attachment backup container therefore runs as `1001:1001`; it remains
capability-free, read-only, and protected with `no-new-privileges`. Do not
change the volume to a broader mode as a backup workaround.

### 7. One-time administrator bootstrap

Review the three bootstrap values first. Then run:

```bash
BOOTSTRAP_CONFIRM=bootstrap-fleetpilot-staging \
docker compose --env-file .env.staging -f docker-compose.staging.yml \
  --profile release run --rm migrate \
  npx tsx scripts/bootstrap-staging-admin.ts
```

The operation is idempotent and creates or activates the internal user, creates
the initial company when needed, grants that user `OWNER`, and selects that
company. It does not link GitHub identity; the first OAuth login links the
pre-provisioned user only when the verified primary email matches.

### 8. Verify exposure and health

```bash
./scripts/health-check-staging.sh
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
sudo ss -lntup
curl -fsSI https://alpha.example.com/api/health
```

Only SSH, 80, and 443 should be externally listening. There must be no host
mapping for port 5432.

## Internal Alpha smoke tests

Use two test companies and two users so isolation can be demonstrated.

1. Sign in through GitHub OAuth with the bootstrapped verified email.
2. Confirm deterministic active-company selection and explicit switching.
3. Load the dashboard and confirm only the active company's aggregates.
4. Open Task Manager; create, edit, move, comment, mention, and checklist a task.
5. Upload and download a task attachment; confirm response headers are private
   and the URL contains no storage key.
6. Create a customer and contact.
7. Create a trailer and upload/download a trailer document.
8. Create a multi-stop load.
9. Assign a same-company driver, truck, and trailer.
10. Move the load through the valid dispatch lifecycle and upload POD.
11. Confirm conflict validation rejects overlapping assignments.
12. As the second-company user, request first-company task, attachment,
    customer, trailer, and load IDs; confirm equivalent non-leaking denial.
13. Verify `/api/health` reports the exact deployed commit.

Document evidence without capturing OAuth tokens, cookies, personal data, or
attachment storage keys.

## GitHub Actions staging environment

Create a protected `staging` environment and add:

- `STAGING_HOST`
- `STAGING_USER`
- `STAGING_SSH_KEY`
- `STAGING_KNOWN_HOSTS`

Where supported, require a reviewer, prevent self-review, restrict deployment
branches, and disallow bypass. The workflow is manual and accepts only a full
commit SHA. GitHub documents environment approvals and secret gating in
[Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Logs and service operation

All services use `json-file` rotation at 10 MB with five files. Inspect:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml logs \
  --since 30m app caddy db
docker compose --env-file .env.staging -f docker-compose.staging.yml restart app
```

Do not log environment files, OAuth payloads, cookies, database URLs, or
attachment contents.

## Rollback

Read the previous image from:

```text
/var/lib/fleetpilot/deployments/previous-image
```

Determine its commit tag, check out that exact compatible commit, set
`APP_COMMIT_SHA` to the prior SHA, and run:

```bash
APP_COMMIT_SHA=PREVIOUS_40_CHARACTER_SHA ./scripts/deploy-staging.sh
```

The migrations in this release are additive and operational rollback is
application-first. Do not attempt an automatic schema downgrade and do not
delete either persistent volume. If rollback follows a bad data migration,
follow the restore runbook instead.

## Pre-launch blockers

- VPS and restricted operator SSH key are not provisioned.
- Staging hostname and DNS record are not selected.
- Separate GitHub OAuth credentials are not created.
- Staging secrets and verified bootstrap administrator are not selected.
- Age identity escrow and encrypted off-host backup destination are not set up.
- A full database plus attachment restore rehearsal has not passed.
- Malware scanning is not included; the alpha file allowlists/signature checks
  are compensating controls and this risk needs explicit acceptance.
- Reserve/TM Fund, Inbox/IMAP, Telegram, and QuickManage remain intentionally
  fail closed until their company ownership mappings are implemented.
- Legacy nullable ownership data must remain fail closed or be reconciled by an
  approved data plan.
