const config = require("./src/config");
const path = require("node:path");
const { AlertStore, applySample, monitorFile } = require("./src/monitoring");
const { ResourceCollector } = require("./src/resource-monitor");
const { DingSender, deliverPending } = require("./src/ding-alerts");

const store = new AlertStore(monitorFile(config.recordingsDir));
store.recoverDelivery();
const collector = new ResourceCollector({ queueFile: config.queueFile, recordingsDir: config.recordingsDir,
  backupDir: process.env.BACKUP_DIR || path.resolve(config.recordingsDir, "../../backups"),
  serviceName: process.env.MONITOR_SERVICE_NAME || "englisheval", healthUrl: `http://127.0.0.1:${config.port}/api/health` });
const sender = new DingSender({ clientId: process.env.DINGTALK_APP_KEY, clientSecret: process.env.DINGTALK_APP_SECRET,
  robotCode: process.env.DINGTALK_ALERT_ROBOT_CODE, userId: process.env.DINGTALK_ALERT_USER_ID });
let stopping = false;
let collecting = false;
let delivering = false;
let timer;
async function tick() {
  if (stopping || collecting) return;
  collecting = true;
  try {
    const sample = await collector.sample(store.get("sample"));
    store.set("notificationsEnabled", process.env.DINGTALK_ALERTS_ENABLED === "true");
    applySample(store, sample, { host: process.env.MONITOR_HOST || "10.1.130.9", adminUrl: `${process.env.APP_BASE_URL || "http://10.1.130.9:3199"}/admin` });
    if (!delivering && process.env.DINGTALK_ALERTS_ENABLED === "true") {
      delivering = true;
      deliverPending(store, sender).catch(() => console.error("Alert delivery state failure")).finally(() => { delivering = false; finish(); });
    }
  } catch { console.error("Resource monitor sample failed"); }
  finally { collecting = false; finish(); }
}
function finish() { if (stopping && !collecting && !delivering) { store.close(); process.exit(0); } }
function stop() { stopping = true; clearInterval(timer); finish(); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
timer = setInterval(tick, 30000);
tick();
