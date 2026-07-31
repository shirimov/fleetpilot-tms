#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env.staging}"
BACKUP_REASON="${1:-scheduled}"

set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${BACKUP_RETENTION_DAYS:?BACKUP_RETENTION_DAYS is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME is required}"

if [[ "${BACKUP_DIR}" != /* || "${BACKUP_DIR}" == "/" ]]; then
  echo "BACKUP_DIR must be a safe absolute directory." >&2
  exit 1
fi
if [[ ! "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_RETENTION_DAYS must be a non-negative integer." >&2
  exit 1
fi
if ! command -v age >/dev/null || ! command -v docker >/dev/null; then
  echo "The host requires age and Docker for encrypted backups." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
chmod 0700 "${BACKUP_DIR}"
exec 9>"${BACKUP_DIR}/.backup.lock"
flock -n 9 || {
  echo "Another FleetPilot backup is already running." >&2
  exit 1
}
umask 077

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
safe_reason="$(printf '%s' "${BACKUP_REASON}" | tr -cd 'a-zA-Z0-9._-' | cut -c1-40)"
prefix="${BACKUP_DIR}/${timestamp}-${safe_reason:-backup}"
database_backup="${prefix}-database.dump.age"
attachment_backup="${prefix}-attachments.tar.gz.age"
manifest="${prefix}.sha256"
completion_marker="${prefix}.complete"
partial_database="${database_backup}.partial"
partial_attachments="${attachment_backup}.partial"
partial_manifest="${manifest}.partial"
partial_completion="${completion_marker}.partial"

cleanup_incomplete_set() {
  local exit_status=$?

  if [[ ! -f "${completion_marker}" ]]; then
    rm -f \
      "${partial_database}" \
      "${partial_attachments}" \
      "${partial_manifest}" \
      "${partial_completion}" \
      "${database_backup}" \
      "${attachment_backup}" \
      "${manifest}"
  fi

  exit "${exit_status}"
}
trap cleanup_incomplete_set EXIT
compose=(docker compose --env-file "${ENV_FILE}" -f "${REPO_ROOT}/docker-compose.staging.yml")

echo "Writing encrypted PostgreSQL backup..."
"${compose[@]}" exec -T db \
  pg_dump --format=custom --no-owner --no-privileges \
  -U "${POSTGRES_USER}" "${POSTGRES_DB}" \
  | age --encrypt --recipient "${BACKUP_AGE_RECIPIENT}" \
  > "${partial_database}"

private_volume="$(
  docker volume ls \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
    --filter "label=com.docker.compose.volume=private_files" \
    --quiet \
    | head -n 1
)"
if [[ -z "${private_volume}" ]]; then
  echo "FleetPilot private attachment volume was not found." >&2
  exit 1
fi

echo "Writing encrypted attachment backup..."
docker run --rm \
  --user 1001:1001 \
  --read-only \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -v "${private_volume}:/private:ro" \
  alpine:3.22 sh -ec 'test "$(id -u):$(id -g)" = "1001:1001"; exec tar -C /private -czf - .' \
  | age --encrypt --recipient "${BACKUP_AGE_RECIPIENT}" \
  > "${partial_attachments}"

mv "${partial_database}" "${database_backup}"
mv "${partial_attachments}" "${attachment_backup}"

(
  cd "${BACKUP_DIR}"
  sha256sum "$(basename "${database_backup}")" "$(basename "${attachment_backup}")"
) > "${partial_manifest}"
mv "${partial_manifest}" "${manifest}"

(
  cd "${BACKUP_DIR}"
  sha256sum --check "$(basename "${manifest}")"
)

printf 'complete\n' > "${partial_completion}"
mv "${partial_completion}" "${completion_marker}"

while IFS= read -r -d '' expired_marker; do
  expired_prefix="${expired_marker%.complete}"
  expiring_marker="${expired_marker}.expiring"
  mv "${expired_marker}" "${expiring_marker}"
  rm -f \
    "${expired_prefix}-database.dump.age" \
    "${expired_prefix}-attachments.tar.gz.age" \
    "${expired_prefix}.sha256" \
    "${expiring_marker}"
done < <(
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name '*.complete' \
    -mtime "+${BACKUP_RETENTION_DAYS}" -print0
)

echo "Backup complete:"
echo "  ${database_backup}"
echo "  ${attachment_backup}"
echo "  ${manifest}"
echo "  ${completion_marker}"
