const path = require("node:path");
const { AlertStore, monitorFile, readMonitorStatus } = require("../src/monitoring");
const recordings = process.env.RECORDINGS_DIR || path.join(process.env.APP_ROOT || path.resolve(__dirname, ".."), "recordings");
const file = monitorFile(recordings);
const [command, minutes] = process.argv.slice(2);
if (command === "status") console.log(JSON.stringify(readMonitorStatus(file), null, 2));
else if (command === "maintenance" || command === "resume") {
  const duration = Number(minutes || 30);
  if (!Number.isFinite(duration) || duration < 1 || duration > 120) throw new Error("Maintenance duration must be 1-120 minutes");
  const store = new AlertStore(file);
  store.set("maintenanceUntil", command === "resume" ? 0 : Date.now() + duration * 60000);
  store.close();
} else throw new Error("Usage: monitor-control.js status|maintenance [minutes]|resume");
