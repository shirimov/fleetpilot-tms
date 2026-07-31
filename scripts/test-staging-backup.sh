#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

for command_name in age age-keygen docker sha256sum tar; do
  if ! command -v "${command_name}" >/dev/null; then
    echo "Required backup test command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

test_root="$(mktemp -d)"
project_name="fleetpilot-backup-test-$$"
env_file="${test_root}/staging.env"
identity_file="${test_root}/age-identity.txt"
backup_dir="${test_root}/backups"
compose=(
  docker compose
  --project-name "${project_name}"
  --env-file "${env_file}"
  -f "${REPO_ROOT}/docker-compose.staging.yml"
)

cleanup() {
  APP_COMMIT_SHA=0000000000000000000000000000000000000000 \
    "${compose[@]}" --profile release down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "${test_root}"
}
trap cleanup EXIT

age-keygen -o "${identity_file}" >/dev/null
recipient="$(sed -n 's/^# public key: //p' "${identity_file}")"
mkdir -p "${backup_dir}"

{
  printf 'COMPOSE_PROJECT_NAME=%s\n' "${project_name}"
  printf 'STAGING_DOMAIN=alpha.example.test\n'
  printf 'APP_URL=https://alpha.example.test\n'
  printf 'CADDY_EMAIL=ops@example.test\n'
  printf 'APP_COMMIT_SHA=0000000000000000000000000000000000000000\n'
  printf 'POSTGRES_DB=fleetpilot_backup_test\n'
  printf 'POSTGRES_USER=fleetpilot\n'
  printf 'POSTGRES_PASSWORD=backup-test-password\n'
  printf 'DATABASE_URL=postgresql://fleetpilot:backup-test-password@db:5432/fleetpilot_backup_test?schema=public\n'
  printf 'AUTH_SECRET=backup-test-auth-secret-with-more-than-32-bytes\n'
  printf 'AUTH_GITHUB_ID=backup-test-client\n'
  printf 'AUTH_GITHUB_SECRET=backup-test-client-secret\n'
  printf 'PRIVATE_FILE_STORAGE_ROOT=/var/lib/fleetpilot/private\n'
  printf 'BACKUP_DIR=%s\n' "${backup_dir}"
  printf 'BACKUP_RETENTION_DAYS=14\n'
  printf 'BACKUP_AGE_RECIPIENT=%s\n' "${recipient}"
  printf 'BACKUP_AGE_IDENTITY_FILE=%s\n' "${identity_file}"
  printf 'DEPLOY_STATE_DIR=%s\n' "${test_root}/deployments"
} > "${env_file}"

"${compose[@]}" up -d db storage-init
storage_init_container="$("${compose[@]}" ps -a -q storage-init)"
if [[ -z "${storage_init_container}" ]]; then
  echo "Disposable storage initializer container was not created." >&2
  exit 1
fi
if [[ "$(docker wait "${storage_init_container}")" != "0" ]]; then
  echo "Disposable storage initialization failed." >&2
  exit 1
fi
for attempt in {1..30}; do
  if "${compose[@]}" exec -T db \
    pg_isready -U fleetpilot -d fleetpilot_backup_test >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "Disposable PostgreSQL did not become ready." >&2
    exit 1
  fi
  sleep 1
done

private_volume="$(
  docker volume ls \
    --filter "label=com.docker.compose.project=${project_name}" \
    --filter "label=com.docker.compose.volume=private_files" \
    --quiet \
    | head -n 1
)"
if [[ -z "${private_volume}" ]]; then
  echo "Disposable private volume was not created." >&2
  exit 1
fi

docker run --rm \
  --user 1001:1001 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -v "${private_volume}:/private" \
  alpine:3.22 \
  sh -ec 'test "$(stat -c "%u:%g:%a" /private)" = "1001:1001:700"; printf "attachment probe\n" > /private/task-attachments/probe.txt'

ENV_FILE="${env_file}" "${SCRIPT_DIR}/backup-staging.sh" regression
completion_marker="$(find "${backup_dir}" -maxdepth 1 -type f -name '*-regression.complete' -print -quit)"
if [[ -z "${completion_marker}" ]]; then
  echo "Backup did not publish a completion marker." >&2
  exit 1
fi
prefix="${completion_marker%.complete}"
"${SCRIPT_DIR}/verify-staging-backup.sh" "${prefix}"

manifest="${prefix}.sha256"
database_backup="${prefix}-database.dump.age"
attachment_backup="${prefix}-attachments.tar.gz.age"
grep -Fq -- "$(basename "${database_backup}")" "${manifest}"
grep -Fq -- "$(basename "${attachment_backup}")" "${manifest}"

age --decrypt --identity "${identity_file}" "${database_backup}" |
  docker run --rm -i postgres:17.5-alpine pg_restore --list >/dev/null
age --decrypt --identity "${identity_file}" "${attachment_backup}" |
  tar -tzf - |
  grep -Fq './task-attachments/probe.txt'

held_attachment="${attachment_backup}.held"
mv "${attachment_backup}" "${held_attachment}"
if "${SCRIPT_DIR}/verify-staging-backup.sh" "${prefix}" >/dev/null 2>&1; then
  echo "Verification incorrectly accepted a missing attachment archive." >&2
  exit 1
fi
mv "${held_attachment}" "${attachment_backup}"
"${SCRIPT_DIR}/verify-staging-backup.sh" "${prefix}" >/dev/null

incomplete_prefix="${backup_dir}/database-only-interrupted"
cp "${database_backup}" "${incomplete_prefix}-database.dump.age"
if "${SCRIPT_DIR}/verify-staging-backup.sh" "${incomplete_prefix}" >/dev/null 2>&1; then
  echo "Verification incorrectly accepted a database-only backup." >&2
  exit 1
fi

echo "Staging backup regression validation passed."
