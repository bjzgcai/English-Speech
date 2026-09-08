const fs = require("node:fs");
const os = require("node:os");

const mediaPipelineVersion = "fused-v1";

function effectiveCpuCount() {
  let cpus = os.availableParallelism();
  // availableParallelism reflects affinity, but not a systemd/cgroup CPU quota.
  if (process.platform === "linux") {
    try {
      const group = fs.readFileSync("/proc/self/cgroup", "utf8").match(/^0::(.*)$/m)?.[1];
      if (group) {
        const parts = group.split("/").filter(Boolean);
        for (let depth = parts.length; depth >= 0; depth--) {
          const file = `/sys/fs/cgroup/${parts.slice(0, depth).join("/")}/cpu.max`;
          if (!fs.existsSync(file)) continue;
          const [quota, period] = fs.readFileSync(file, "utf8").trim().split(/\s+/);
          if (quota !== "max" && Number(quota) > 0 && Number(period) > 0) cpus = Math.min(cpus, Number(quota) / Number(period));
        }
      }
    } catch { /* Use affinity when quota information is unavailable. */ }
  }
  return cpus;
}

function mediaConcurrency(value = process.env.FFMPEG_CONCURRENCY, cpus = effectiveCpuCount()) {
  if (value !== undefined && value !== "") {
    if (!/^[1-4]$/.test(String(value))) throw new Error("FFMPEG_CONCURRENCY must be between 1 and 4.");
    return Number(value);
  }
  return Math.max(1, Math.min(2, Math.floor(cpus)));
}

function pipelineConcurrency(value = process.env.WORKER_CONCURRENCY) {
  if (value === undefined || value === "") return 4;
  if (!/^(?:[1-9]|1[0-6])$/.test(String(value))) throw new Error("WORKER_CONCURRENCY must be between 1 and 16.");
  return Number(value);
}

module.exports = { mediaPipelineVersion, mediaConcurrency, effectiveCpuCount, pipelineConcurrency };
