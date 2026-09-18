#!/usr/bin/env bash
set -euo pipefail

EVIDENCE="${EVIDENCE:-${RUNNER_TEMP:-/tmp}/saturn-target-evidence}"
mkdir -p "$EVIDENCE"
PASSWORD="$(node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))")"
REPORT_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))")"

{
  echo "runner_name=${RUNNER_NAME:-local}"
  echo "runner_os=${RUNNER_OS:-$(uname -s)}"
  echo "runner_arch=${RUNNER_ARCH:-$(uname -m)}"
  uname -a || true
  cat /etc/os-release 2>/dev/null || true
  echo "node=$(node --version)"
  echo "npm=$(npm --version)"
  echo "bun=$(bun --version 2>/dev/null || echo unavailable)"
  git --version
  docker --version 2>/dev/null || echo "docker=unavailable"
  docker compose version 2>/dev/null || echo "docker_compose=unavailable"
} | tee "$EVIDENCE/environment.txt"

npm ci
npm run plant:check 2>&1 | tee "$EVIDENCE/plant-check.log"
node scripts/plant-build.mjs 2>&1 | tee "$EVIDENCE/build.log"

run_node_target() {
  local root="$RUNNER_TEMP/saturn-node-target"
  rm -rf "$root"; mkdir -p "$root"
  cat > "$root/connections.json" <<'JSON'
{"connections":[{"id":"plc-main","driver":"modbus-tcp","readOnly":false,"options":{"host":"127.0.0.1","port":15020,"unitId":1,"timeoutMs":1000}}]}
JSON
  local modbus_pid server_pid worker_pid
  MODBUS_STATS="$EVIDENCE/node-modbus-stats.json" MODBUS_PORT=15020 node scripts/self-hosted-modbus-server.mjs >"$EVIDENCE/node-modbus.log" 2>&1 & modbus_pid=$!
  HOST=127.0.0.1 PORT=4176 SATURN_DATABASE="$root/saturn.sqlite3" SATURN_PROJECT_REPO="$root/project.git"     SATURN_PASSWORD="$PASSWORD" SATURN_CONNECTIONS_FILE="$root/connections.json" SATURN_WORKERS=external     SATURN_WORKER_TOKENS="{\"$REPORT_TOKEN\":[\"report\"]}"     node --experimental-sqlite .plant/server.mjs >"$EVIDENCE/node-server.log" 2>&1 & server_pid=$!
  cleanup_node(){ kill "$worker_pid" "$server_pid" "$modbus_pid" 2>/dev/null || true; wait "$worker_pid" "$server_pid" "$modbus_pid" 2>/dev/null || true; }
  trap cleanup_node RETURN
  for _ in $(seq 1 80); do node -e "fetch('http://127.0.0.1:4176/plant/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep .25; done
  node -e "fetch('http://127.0.0.1:4176/plant/api/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})" | tee "$EVIDENCE/node-health.json"
  SATURN_SERVER_URL=http://127.0.0.1:4176/plant/worker/ SATURN_WORKER_TOKEN="$REPORT_TOKEN" SATURN_WORKER_CAPABILITIES=report SATURN_WORKER_ID=self-hosted-report-1     node .plant/worker.mjs >"$EVIDENCE/report-worker.log" 2>&1 & worker_pid=$!
  SATURN_SMOKE_URL=http://127.0.0.1:4176/plant/ SATURN_SMOKE_PASSWORD="$PASSWORD" SATURN_SMOKE_OUTPUT="$EVIDENCE/node-demo-signals.json" node scripts/self-hosted-server-smoke.mjs
  SATURN_SMOKE_URL=http://127.0.0.1:4176/plant/ SATURN_SMOKE_PASSWORD="$PASSWORD" SATURN_SMOKE_OUTPUT="$EVIDENCE/node-live-modbus.json" node scripts/self-hosted-live-smoke.mjs
  kill "$modbus_pid" 2>/dev/null || true; wait "$modbus_pid" 2>/dev/null || true
  modbus_pid=0
  sleep 1
  node -e "fetch('http://127.0.0.1:4176/plant/api/health').then(async r=>console.log(await r.text()))" >"$EVIDENCE/node-health-after-live.json"
  cleanup_node
  trap - RETURN
}

run_bun_target() {
  if ! command -v bun >/dev/null; then echo "bun unavailable" | tee "$EVIDENCE/bun-skipped.txt"; return; fi
  local root="$RUNNER_TEMP/saturn-bun-target"
  rm -rf "$root"; mkdir -p "$root"
  cat > "$root/connections.json" <<'JSON'
{"connections":[{"id":"plc-main","driver":"modbus-tcp","readOnly":false,"options":{"host":"127.0.0.1","port":15021,"unitId":1,"timeoutMs":1000}}]}
JSON
  local modbus_pid server_pid
  MODBUS_STATS="$EVIDENCE/bun-modbus-stats.json" MODBUS_PORT=15021 node scripts/self-hosted-modbus-server.mjs >"$EVIDENCE/bun-modbus.log" 2>&1 & modbus_pid=$!
  HOST=127.0.0.1 PORT=4177 SATURN_DATABASE="$root/saturn.sqlite3" SATURN_PROJECT_REPO="$root/project.git" SATURN_PASSWORD="$PASSWORD" SATURN_CONNECTIONS_FILE="$root/connections.json"     bun .plant/server.mjs >"$EVIDENCE/bun-server.log" 2>&1 & server_pid=$!
  cleanup_bun(){ kill "$server_pid" "$modbus_pid" 2>/dev/null || true; wait "$server_pid" "$modbus_pid" 2>/dev/null || true; }
  trap cleanup_bun RETURN
  for _ in $(seq 1 80); do node -e "fetch('http://127.0.0.1:4177/plant/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep .25; done
  node -e "fetch('http://127.0.0.1:4177/plant/api/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)})" | tee "$EVIDENCE/bun-health.json"
  SATURN_SMOKE_URL=http://127.0.0.1:4177/plant/ SATURN_SMOKE_PASSWORD="$PASSWORD" SATURN_SMOKE_OUTPUT="$EVIDENCE/bun-demo-signals.json" node scripts/self-hosted-server-smoke.mjs
  SATURN_SMOKE_URL=http://127.0.0.1:4177/plant/ SATURN_SMOKE_PASSWORD="$PASSWORD" SATURN_SMOKE_OUTPUT="$EVIDENCE/bun-live-modbus.json" node scripts/self-hosted-live-smoke.mjs
  cleanup_bun
  trap - RETURN
}

run_docker_target() {
  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose is not installed on this self-hosted runner." | tee "$EVIDENCE/docker-skipped.txt"; return
  fi
  local project="saturn-target-${GITHUB_RUN_ID:-local}"
  docker compose -f compose.yaml -f compose.workers.yaml config >"$EVIDENCE/compose-workers-rendered.yaml"
  SATURN_PORT=4178 SATURN_PASSWORD="$PASSWORD" docker compose -p "$project" build saturn 2>&1 | tee "$EVIDENCE/docker-build.log"
  SATURN_PORT=4178 SATURN_PASSWORD="$PASSWORD" docker compose -p "$project" up -d saturn
  cleanup_docker(){ SATURN_PORT=4178 SATURN_PASSWORD="$PASSWORD" docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true; }
  trap cleanup_docker RETURN
  for _ in $(seq 1 120); do node -e "fetch('http://127.0.0.1:4178/plant/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep .5; done
  docker compose -p "$project" ps | tee "$EVIDENCE/docker-ps.txt"
  docker compose -p "$project" logs --no-color saturn >"$EVIDENCE/docker-server.log"
  SATURN_SMOKE_URL=http://127.0.0.1:4178/plant/ SATURN_SMOKE_PASSWORD="$PASSWORD" SATURN_SMOKE_OUTPUT="$EVIDENCE/docker-demo-signals.json" node scripts/self-hosted-server-smoke.mjs
  cleanup_docker
  trap - RETURN
}

run_node_target
run_bun_target
run_docker_target

echo "Saturn target verification complete: $EVIDENCE"
