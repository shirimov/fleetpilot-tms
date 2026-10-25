#!/usr/bin/env bash
# Creates only disposable PR99 fixtures. Never reads a production connection URL.
set -euo pipefail
cd "$(dirname "$0")/.."
network=fleetpilot-drivers-pr99-verify
postgres=fleetpilot-drivers-pr99-verify
relay=fleetpilot-drivers-pr99-relay
for container in "$postgres" "$relay"; do
  if docker container inspect "$container" >/dev/null 2>&1; then
    echo "Refusing to replace existing container: $container" >&2
    exit 1
  fi
done
if docker network inspect "$network" >/dev/null 2>&1; then
  echo "Refusing to replace existing network: $network" >&2
  exit 1
fi
# Refuse occupied app/database ports before starting or sending HTTP requests.
node <<'JS'
const net = require('node:net');
Promise.all([15439, 3124].map(port => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => server.close(resolve));
}))).catch(error => { console.error('Verification ports must be unused:', error.message); process.exit(1); });
JS
logs=$(mktemp -d "${TMPDIR:-/tmp}/drivers-pr99-verify.XXXXXX")
bridge_pid=''
app_pid=''
created_network=false
created_postgres=false
created_relay=false
cleanup() {
  if [[ -n "$app_pid" ]]; then kill -TERM "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true; fi
  if [[ -n "$bridge_pid" ]]; then kill -INT "$bridge_pid" 2>/dev/null || true; wait "$bridge_pid" 2>/dev/null || true; fi
  if [[ "$created_relay" == true ]]; then docker rm -f "$relay" >/dev/null; fi
  if [[ "$created_postgres" == true ]]; then docker rm -f "$postgres" >/dev/null; fi
  if [[ "$created_network" == true ]]; then docker network rm "$network" >/dev/null; fi
  echo "Verification logs: $logs"
}
trap cleanup EXIT
# Use only existing local images; this runner does not pull or contact providers.
docker image inspect postgres:17.5-alpine >/dev/null
docker image inspect node:20-bookworm-slim >/dev/null
docker network create --internal --label fleetpilot.purpose=drivers-pr99-verification "$network" >/dev/null
created_network=true
docker run -d --name "$postgres" --label fleetpilot.purpose=drivers-pr99-verification \
  --network "$network" --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=1536m \
  -e POSTGRES_DB=fleetpilot_drivers_verify -e POSTGRES_USER=drivers_verify \
  -e POSTGRES_PASSWORD=drivers-isolated-test-only postgres:17.5-alpine >/dev/null
created_postgres=true
for attempt in {1..30}; do
  if docker exec "$postgres" pg_isready -U drivers_verify -d fleetpilot_drivers_verify >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$postgres" pg_isready -U drivers_verify -d fleetpilot_drivers_verify >/dev/null
docker run -d --name "$relay" --label fleetpilot.purpose=drivers-pr99-verification \
  --network "$network" --mount "type=bind,source=$PWD/tests/helpers/drivers-db-relay-container.mjs,target=/relay.mjs,readonly" \
  node:20-bookworm-slim sleep infinity >/dev/null
created_relay=true
node tests/helpers/drivers-db-relay-host.mjs > "$logs/database-relay.log" 2>&1 &
bridge_pid=$!
export DATABASE_URL=postgresql://drivers_verify:drivers-isolated-test-only@127.0.0.1:15439/fleetpilot_drivers_verify
export AUTH_SECRET=fleetpilot-drivers-db-test-only
export AUTH_URL=http://127.0.0.1:3124
export AUTH_TRUST_HOST=true
export EMAIL_AUTH_ENABLED=false
export TELEGRAM_ENABLED=false
for attempt in {1..30}; do
  if rg -q 'relay ready' "$logs/database-relay.log"; then break; fi
  kill -0 "$bridge_pid"
  sleep 1
done
rg -q 'relay ready' "$logs/database-relay.log"
npx prisma migrate deploy > "$logs/migrations.log" 2>&1
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3124 > "$logs/app.log" 2>&1 &
app_pid=$!
for attempt in {1..60}; do
  if curl --fail --silent http://127.0.0.1:3124/api/health >/dev/null; then break; fi
  kill -0 "$app_pid"
  sleep 1
done
kill -0 "$app_pid"
curl --fail --silent http://127.0.0.1:3124/api/health >/dev/null
npx tsx --test src/lib/fleet/driver-profile.test.ts src/lib/fleet/driver-access.test.ts | tee "$logs/drivers-unit.log"
npx playwright test --config playwright.drivers-db.config.ts | tee "$logs/drivers-database.log"
if [[ "${1:-}" == '--regression' ]]; then npm test | tee "$logs/regression.log"; fi
