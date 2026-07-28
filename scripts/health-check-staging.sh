#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env.staging}"

set -a
source "${ENV_FILE}"
set +a

: "${APP_URL:?APP_URL is required}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-${APP_COMMIT_SHA:-}}"
health_url="${APP_URL%/}/api/health"

for attempt in {1..30}; do
  response="$(curl --fail --silent --show-error \
    --connect-timeout 5 --max-time 10 "${health_url}" 2>/dev/null || true)"
  if [[ "${response}" == *'"status":"ok"'* && "${response}" == *'"database":"ok"'* ]]; then
    if [[ -n "${EXPECTED_COMMIT}" && "${response}" != *"\"commit\":\"${EXPECTED_COMMIT}\""* ]]; then
      echo "Health endpoint is serving a different commit." >&2
      exit 1
    fi
    echo "Healthy: ${health_url}"
    exit 0
  fi
  sleep 5
done

echo "Health check failed: ${health_url}" >&2
exit 1
