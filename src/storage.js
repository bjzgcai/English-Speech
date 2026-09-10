const fs = require("fs");
const path = require("node:path");

const cache = new Map();
// A JSONL rewrite is not atomic with respect to a concurrent append, so every
// writer takes an exclusive lock. The lock is a sibling file so it works across
// processes (web server, queue worker, retention timer).
const lockTimeoutMs = 15000;
const lockStaleMs = 30000;
const lockRetryMs = 20;
const heldLocks = new Set();

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withFileLock(filePath, fn) {
  // Nested calls from the same process reuse the lock they already hold.
  if (heldLocks.has(filePath)) return fn();

  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + lockTimeoutMs;
  let handle = null;
  for (;;) {
    try {
      handle = fs.openSync(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        // A holder that crashed must not block writers forever.
        if (Date.now() - fs.statSync(lockPath).mtimeMs > lockStaleMs) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch { /* The holder released the lock between open and stat. */ }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the write lock on ${path.basename(filePath)}.`);
      }
      sleepSync(lockRetryMs);
    }
  }

  heldLocks.add(filePath);
  try {
    return fn();
  } finally {
    heldLocks.delete(filePath);
    try { fs.closeSync(handle); } catch { /* The descriptor is already closed. */ }
    fs.rmSync(lockPath, { force: true });
  }
}

function readJsonLinesUnlocked(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const stat = fs.statSync(filePath);
  const key = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  if (cache.get(filePath)?.key === key) return structuredClone(cache.get(filePath).records);

  const records = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  cache.set(filePath, { key, records });
  return structuredClone(records);
}

function writeJsonLinesUnlocked(filePath, records) {
  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  const contents = records.length
    ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
    : "";
  fs.writeFileSync(temporaryFile, contents, { mode: 0o600 });
  const descriptor = fs.openSync(temporaryFile, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporaryFile, filePath);
  const directory = fs.openSync(path.dirname(filePath), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  cache.delete(filePath);
}

function appendJsonLineUnlocked(filePath, record) {
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  const descriptor = fs.openSync(filePath, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  cache.delete(filePath);
}

function readJsonLines(filePath) {
  return readJsonLinesUnlocked(filePath);
}

function writeJsonLines(filePath, records) {
  return withFileLock(filePath, () => writeJsonLinesUnlocked(filePath, records));
}

function appendJsonLine(filePath, record) {
  withFileLock(filePath, () => appendJsonLineUnlocked(filePath, record));
}

// Read-modify-write inside a single lock. The transform receives the current
// records and returns the next array; returning the same array (or a non-array)
// skips the rewrite. An append made by another process cannot be lost because
// the read happens inside the same critical section as the write.
function updateJsonLines(filePath, transform) {
  return withFileLock(filePath, () => {
    const records = readJsonLinesUnlocked(filePath);
    const next = transform(records);
    if (!Array.isArray(next) || next === records) return records;
    writeJsonLinesUnlocked(filePath, next);
    return next;
  });
}

module.exports = {
  appendJsonLine,
  readJsonLines,
  updateJsonLines,
  withFileLock,
  writeJsonLines,
};
