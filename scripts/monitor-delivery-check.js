// Explicit opt-in smoke test: send two labeled DINGs using isolated state.
const config = require("../src/config");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AlertStore, applySample, GiB, MiB } = require("../src/monitoring");
const { DingSender, deliverPending } = require("../src/ding-alerts");
async function main() {
  if (process.env.MONITOR_TEST_SEND !== "true") throw new Error("Set MONITOR_TEST_SEND=true to send the authorized test DINGs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-ding-test-"));
  const store = new AlertStore(path.join(dir, "alerts.sqlite"));
  try {
    const base = Date.now() - 360000;
    for (let elapsed = 0; elapsed <= 330000; elapsed += 30000) {
      const at = base + elapsed;
      applySample(store, { at, errors: [], disks: [], services: [], cpuPercent: 10, memoryAvailable: elapsed <= 120000 ? 700 * MiB : 2 * GiB,
        health: { ok: true, latencyMs: 20 }, queue: { outstanding: 0, waiting: 0, reservedBytes: 0, workerHeartbeat: at, circuitUntil: 0 } },
      { host: "10.1.130.9（测试消息：模拟异常与恢复，不代表实际资源不足）", adminUrl: `${process.env.APP_BASE_URL}/admin` });
    }
    const sender = new DingSender({ clientId: process.env.DINGTALK_APP_KEY, clientSecret: process.env.DINGTALK_APP_SECRET,
      robotCode: process.env.DINGTALK_ALERT_ROBOT_CODE, userId: process.env.DINGTALK_ALERT_USER_ID });
    await deliverPending(store, sender);
    await deliverPending(store, sender);
    const events = store.db.prepare("SELECT id,level,status,receipt FROM events ORDER BY created").all();
    console.log(JSON.stringify({ isolatedState: dir, events }));
    if (events.length !== 2 || events.some(event => event.status !== "sent")) process.exitCode = 1;
  } finally { store.close(); }
}
main().catch(() => { console.error("DING smoke test failed"); process.exitCode = 1; });
