#!/usr/bin/env bash
# Execute on the production host. The benchmark creates and owns its temporary data.
set -Eeuo pipefail

TEST_ROOT="${TEST_ROOT:-/opt/englisheval/current}"
PRODUCTION_ROOT="${PRODUCTION_ROOT:-/opt/englisheval}"
BENCHMARK_CPU_QUOTA="${BENCHMARK_CPU_QUOTA:-100%}"
BENCHMARK_MEMORY_MIB="${BENCHMARK_MEMORY_MIB:-1400}"
UNIT="englisheval-load-$(date -u +%Y%m%dT%H%M%SZ)-$$"
[[ "$BENCHMARK_CPU_QUOTA" =~ ^(50|100|200|300|400)%$ ]] || { echo "CPU quota must be 50%, 100%, 200%, 300%, or 400%." >&2; exit 1; }
[[ "$BENCHMARK_MEMORY_MIB" =~ ^[1-9][0-9]{2,3}$ ]] && ((BENCHMARK_MEMORY_MIB >= 600 && BENCHMARK_MEMORY_MIB <= 4096)) || { echo "Memory limit must be 600-4096 MiB." >&2; exit 1; }
minimum_available_kib=786432
if ((BENCHMARK_MEMORY_MIB > 2048)); then minimum_available_kib=2097152; fi
test -f "$TEST_ROOT/scripts/load-benchmark.js"

check_health() {
  curl --fail --silent --max-time 3 http://127.0.0.1:3199/api/health >/dev/null || return 1
  awk -v minimum="$minimum_available_kib" '/MemAvailable:/ { exit ($2 < minimum) }' /proc/meminfo || return 1
  test "$(df --output=avail -k "$PRODUCTION_ROOT/shared/recordings" | tail -n 1)" -gt 10485760 || return 1
  node - "$PRODUCTION_ROOT/shared/recordings/queue.sqlite" <<'JS'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2], { readOnly: true });
try {
  const active = db.prepare("SELECT count(*) AS n FROM jobs WHERE state IN ('queued','processing')").get().n;
  if (active) process.exitCode = 1;
} finally { db.close(); }
JS
}

check_health || { echo "Production is busy or below the test resource margin; no load started." >&2; exit 1; }
runner_pid=""
cleanup() {
  sudo systemctl stop "$UNIT.service" 2>/dev/null || true
  if [[ -n "$runner_pid" ]]; then wait "$runner_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM
sudo systemd-run --quiet --wait --pipe --collect --unit="$UNIT" \
  -p User="$(id -un)" -p WorkingDirectory="$TEST_ROOT" \
  -p CPUQuota="$BENCHMARK_CPU_QUOTA" -p MemoryHigh="$((BENCHMARK_MEMORY_MIB * 3 / 4))M" -p MemoryMax="${BENCHMARK_MEMORY_MIB}M" \
  -p Nice=15 -p KillMode=control-group -p RuntimeMaxSec=2400 -p UMask=0077 \
  /usr/bin/node "$TEST_ROOT/scripts/load-benchmark.js" "$@" &
runner_pid=$!
while kill -0 "$runner_pid" 2>/dev/null; do
  if ! NODE_NO_WARNINGS=1 check_health; then
    echo "Load stopped: production traffic, health, memory, or disk margin changed." >&2
    exit 1
  fi
  sleep 3
done
wait "$runner_pid"
runner_pid=""
