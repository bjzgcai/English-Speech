const fs = require("node:fs");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");
const { MiB } = require("./monitoring");
const execute = promisify(execFile);

class ResourceCollector {
  constructor({ queueFile, recordingsDir, backupDir, serviceName = "englisheval", healthUrl = "http://127.0.0.1:3199/api/health" }) {
    Object.assign(this, { queueFile, recordingsDir, backupDir, serviceName, healthUrl });
  }
  async sample(previous = null) {
    const at = Date.now();
    const sample = { at, errors: [], disks: [], services: [], queue: null, memoryAvailable: null, cpuPercent: null };
    let db;
    try {
      db = new DatabaseSync(this.queueFile, { readOnly: true }); db.exec("PRAGMA busy_timeout=100");
      db.exec("BEGIN");
      const settings = Object.fromEntries(db.prepare("SELECT key,value FROM settings WHERE key IN ('workerHeartbeat','circuitUntil','paused')").all().map(row => [row.key, row.value]));
      const counts = db.prepare("SELECT state,count(*) AS n FROM admissions GROUP BY state").all();
      const outstanding = counts.filter(row => row.state !== "waiting").reduce((sum, row) => sum + row.n, 0);
      sample.queue = { outstanding, reservedBytes: outstanding * 512 * MiB, waiting: counts.find(row => row.state === "waiting")?.n || 0,
        workerHeartbeat: Number(settings.workerHeartbeat || 0), circuitUntil: Number(settings.circuitUntil || 0), paused: settings.paused === "true" };
      db.exec("COMMIT");
    } catch { /* Queue availability has its own alert. */ }
    finally { db?.close(); }
    const devices = new Map();
    for (const [directory, data] of [[this.recordingsDir, true], [this.backupDir, false]]) {
      try {
        const stat = fs.statSync(directory); const disk = fs.statfsSync(directory);
        let item = devices.get(stat.dev);
        if (!item) {
          const available = disk.bavail * disk.bsize; const used = (disk.blocks - disk.bfree) * disk.bsize;
          item = { device: String(stat.dev), paths: [], data: false, available, usedPercent: used / (used + available) * 100 };
          devices.set(stat.dev, item);
        }
        item.paths.push(directory); item.data ||= data;
      } catch { sample.errors.push(data ? "data_disk_unreadable" : "backup_disk_unreadable"); }
    }
    sample.disks = [...devices.values()];
    try {
      const memory = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)/m);
      if (!memory) throw new Error("missing");
      sample.memoryAvailable = Number(memory[1]) * 1024;
      const cpu = fs.readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1, 9).map(Number);
      sample.cpuTicks = { total: cpu.reduce((sum, item) => sum + item, 0), idle: cpu[3] + cpu[4] };
      if (previous?.cpuTicks && sample.cpuTicks.total > previous.cpuTicks.total) sample.cpuPercent = Math.max(0, Math.min(100, 100 * (1 - (sample.cpuTicks.idle - previous.cpuTicks.idle) / (sample.cpuTicks.total - previous.cpuTicks.total))));
    } catch { sample.errors.push("host_resources_unreadable"); }
    sample.services = await Promise.all([this.serviceName, `${this.serviceName}-worker`].map(async name => {
      try {
        const { stdout } = await execute("systemctl", ["show", `${name}.service`, "--property=ActiveState,MemoryCurrent,MemoryMax,ControlGroup,Result"], { timeout: 3000, maxBuffer: 8192 });
        const fields = Object.fromEntries(stdout.trim().split("\n").map(line => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
        let oomCount = null;
        if (fields.ControlGroup) {
          try {
            const events = fs.readFileSync(`/sys/fs/cgroup${fields.ControlGroup}/memory.events`, "utf8");
            oomCount = Number(events.match(/^oom_kill (\d+)/m)?.[1] || 0);
          } catch { sample.errors.push(`cgroup_unreadable:${name}`); }
        }
        const prior = previous?.services?.find(service => service.name === name);
        const current = Number(fields.MemoryCurrent);
        return { name, active: fields.ActiveState === "active", memoryCurrent: Number.isFinite(current) && current < Number.MAX_SAFE_INTEGER ? current : null,
          memoryMax: Number(fields.MemoryMax), oomCount,
          oom: fields.Result === "oom-kill" || (oomCount != null && oomCount > (prior?.oomCount || 0)) };
      } catch { sample.errors.push(`service_unreadable:${name}`); return { name, active: false }; }
    }));
    const start = performance.now();
    try {
      const response = await fetch(this.healthUrl, { signal: AbortSignal.timeout(3000) });
      const body = await response.json();
      sample.health = { ok: response.ok && body.ok === true, latencyMs: performance.now() - start, status: response.status };
    } catch { sample.health = { ok: false, latencyMs: performance.now() - start }; }
    return sample;
  }
}
module.exports = { ResourceCollector };
