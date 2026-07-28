#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${RESTORE_CONFIRM:-}" != "restore-fleetpilot-staging" ]]; then
  echo "Set RESTORE_CONFIRM=restore-fleetpilot-staging to acknowledge destructive restore." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env.staging}"
DATABASE_BACKUP="${1:?Pass the encrypted database backup path}"
ATTACHMENT_BACKUP="${2:-}"

set -a
source "${ENV_FILE}"
set +a

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME is required}"
: "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE is required}"

if [[ ! -f "${BACKUP_AGE_IDENTITY_FILE}" ]]; then
  echo "Backup age identity file not found." >&2
  exit 1
fi

for backup in "${DATABASE_BACKUP}" ${ATTACHMENT_BACKUP:+"${ATTACHMENT_BACKUP}"}; do
  if [[ ! -f "${backup}" ]]; then
    echo "Backup file not found: ${backup}" >&2
    exit 1
  fi
done

compose=(docker compose --env-file "${ENV_FILE}" -f "${REPO_ROOT}/docker-compose.staging.yml")
"${compose[@]}" stop caddy app
"${compose[@]}" up -d db

echo "Restoring PostgreSQL..."
age --decrypt --identity "${BACKUP_AGE_IDENTITY_FILE}" "${DATABASE_BACKUP}" \
  | "${compose[@]}" exec -T db \
      pg_restore --clean --if-exists --no-owner --no-privileges \
      -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

if [[ -n "${ATTACHMENT_BACKUP}" ]]; then
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
  echo "Replacing private attachment volume contents..."
  docker run --rm \
    --security-opt no-new-privileges:true \
    --cap-drop ALL \
    -v "${private_volume}:/private" \
    alpine:3.22 sh -c 'find /private -mindepth 1 -delete'
  age --decrypt --identity "${BACKUP_AGE_IDENTITY_FILE}" "${ATTACHMENT_BACKUP}" \
    | docker run --rm -i \
        --security-opt no-new-privileges:true \
        --cap-drop ALL \
        -v "${private_volume}:/private" \
        alpine:3.22 tar -C /private -xzf -
  "${compose[@]}" up storage-init
fi

"${compose[@]}" up -d app caddy
ENV_FILE="${ENV_FILE}" "${SCRIPT_DIR}/health-check-staging.sh"
echo "Staging restore completed and passed health verification."
