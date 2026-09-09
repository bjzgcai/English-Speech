const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

function createMemoryReader({ platform = process.platform, free = os.freemem, total = os.totalmem, read = fs.readFileSync, exec = execFileSync, now = Date.now } = {}) {
  let cached;
  let expires = 0;
  return function availableMemory() {
    if (platform === "linux") {
      const match = read("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)/m);
      if (match) return Number(match[1]) * 1024;
    }
    if (platform === "darwin") {
      if (now() < expires) return cached;
      try {
        // macOS uses otherwise available RAM for caches. Raw freemem alone
        // can block an idle queue; query the OS's memory availability instead.
        const output = exec("/usr/bin/memory_pressure", ["-Q"], { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] });
        const match = output.match(/System-wide memory free percentage:\s*(\d+)%/);
        if (match && Number(match[1]) <= 100) {
          cached = total() * Number(match[1]) / 100;
          expires = now() + 5000;
          return cached;
        }
      } catch { /* Fall back conservatively if the OS query is unavailable. */ }
      cached = free();
      expires = now() + 5000;
      return cached;
    }
    return free();
  };
}

module.exports = { availableMemory: createMemoryReader(), createMemoryReader };
