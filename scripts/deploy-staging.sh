#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env.staging}"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.staging.yml"
RELEASE_COMMIT_SHA="${APP_COMMIT_SHA:-}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing staging environment file: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# The staging environment file is root/operator-managed and must not contain shell code.
source "${ENV_FILE}"
set +a
APP_COMMIT_SHA="${RELEASE_COMMIT_SHA:-${APP_COMMIT_SHA:-}}"

: "${APP_COMMIT_SHA:?APP_COMMIT_SHA is required}"
: "${DEPLOY_STATE_DIR:?DEPLOY_STATE_DIR is required}"

if [[ ! "${APP_COMMIT_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "APP_COMMIT_SHA must be a full 40-character lowercase Git SHA." >&2
  exit 1
fi
if [[ "${DEPLOY_STATE_DIR}" != /* || "${DEPLOY_STATE_DIR}" == "/" ]]; then
  echo "DEPLOY_STATE_DIR must be a safe absolute directory." >&2
  exit 1
fi

cd "${REPO_ROOT}"
if [[ "$(git rev-parse HEAD)" != "${APP_COMMIT_SHA}" ]]; then
  echo "Checked-out commit does not match APP_COMMIT_SHA." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "Refusing to deploy a dirty working tree." >&2
  exit 1
fi

compose=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")
mkdir -p "${DEPLOY_STATE_DIR}"
chmod 0700 "${DEPLOY_STATE_DIR}"

previous_image="$("${compose[@]}" ps -q app 2>/dev/null | xargs -r docker inspect --format '{{.Config.Image}}' 2>/dev/null || true)"
if [[ -n "${previous_image}" ]]; then
  printf '%s\n' "${previous_image}" > "${DEPLOY_STATE_DIR}/previous-image"
  chmod 0600 "${DEPLOY_STATE_DIR}/previous-image"
fi

echo "Building exact commit ${APP_COMMIT_SHA}..."
"${compose[@]}" --profile release build --pull app migrate

echo "Starting private database and attachment volume..."
"${compose[@]}" up -d db storage-init
for attempt in {1..30}; do
  if "${compose[@]}" exec -T db pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "PostgreSQL did not become ready." >&2
    exit 1
  fi
  sleep 2
done

echo "Creating encrypted pre-migration backups..."
ENV_FILE="${ENV_FILE}" "${SCRIPT_DIR}/backup-staging.sh" pre-migration

echo "Applying Prisma migrations as a one-shot release step..."
if ! "${compose[@]}" --profile release run --rm migrate; then
  echo "Migration failed; application release was not started." >&2
  exit 1
fi

echo "Starting the application and HTTPS proxy..."
"${compose[@]}" up -d db storage-init app caddy

if ! ENV_FILE="${ENV_FILE}" EXPECTED_COMMIT="${APP_COMMIT_SHA}" "${SCRIPT_DIR}/health-check-staging.sh"; then
  echo "Release health verification failed." >&2
  if [[ -n "${previous_image}" ]]; then
    echo "Previous image retained: ${previous_image}" >&2
    echo "Follow the documented rollback procedure before retrying." >&2
  fi
  exit 1
fi

printf '%s\n' "${FLEETPILOT_IMAGE_REPOSITORY:-fleetpilot-staging}-app:${APP_COMMIT_SHA}" \
  > "${DEPLOY_STATE_DIR}/current-image"
chmod 0600 "${DEPLOY_STATE_DIR}/current-image"
echo "Healthy staging release: ${APP_COMMIT_SHA}"
