const fs = require("fs");
const path = require("path");
const { readJsonLines, updateJsonLines } = require("./storage");

const dayMs = 24 * 60 * 60 * 1000;

function parseRetentionDays(value) {
  if (value === undefined || value === null || String(value).trim() === "") return 0;
  if (!/^\d+$/.test(String(value).trim())) {
    throw new Error("RECORDING_RETENTION_DAYS must be a non-negative integer.");
  }

  const days = Number(value);
  if (!Number.isSafeInteger(days)) {
    throw new Error("RECORDING_RETENTION_DAYS is too large.");
  }
  return days;
}

function isSafeName(value) {
  return typeof value === "string" && value.length > 0 && path.basename(value) === value;
}

function expireRecordings({
  artifactsDir,
  metadataFile,
  now = new Date(),
  recordingsDir,
  retentionDays,
}) {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 0) {
    throw new Error("retentionDays must be a non-negative integer.");
  }
  if (retentionDays === 0) return { expired: 0, failed: 0 };

  const cutoff = now.getTime() - retentionDays * dayMs;
  const records = readJsonLines(metadataFile);
  const expiredKeys = new Set();
  let failed = 0;

  // Media removal happens before the metadata commit so a failure leaves the
  // record untouched rather than pointing at a file that no longer exists.
  for (const record of records) {
    if (!record?.filename || !isSafeName(record.filename)) continue;

    const finishedAt = Date.parse(record.finishedAt || record.startedAt || "");
    if (!Number.isFinite(finishedAt) || finishedAt > cutoff) continue;

    try {
      if (isSafeName(record.id)) fs.rmSync(path.join(artifactsDir, record.id), { recursive: true, force: true });
      fs.rmSync(path.join(recordingsDir, record.filename), { force: true });
    } catch (error) {
      failed += 1;
      console.error(`Unable to expire recording ${record.id || "unknown"}: ${error.message}`);
      continue;
    }

    expiredKeys.add(record.id || `filename:${record.filename}`);
  }

  if (!expiredKeys.size) return { expired: 0, failed };

  // This process runs on a timer, separately from the web server. Marking the
  // records inside the shared write lock means an answer saved concurrently is
  // never lost by this rewrite.
  updateJsonLines(metadataFile, (current) => {
    let changed = false;
    const marked = current.map((record) => {
      if (!record?.filename || !isSafeName(record.filename)) return record;
      if (!expiredKeys.has(record.id || `filename:${record.filename}`)) return record;
      changed = true;
      return {
        ...record,
        hasVideo: false,
        filename: null,
        mimeType: null,
        bytes: 0,
        recordingDeletedAt: now.toISOString(),
        recordingDeletionReason: "retention",
      };
    });
    return changed ? marked : current;
  });

  return { expired: expiredKeys.size, failed };
}

module.exports = { expireRecordings, parseRetentionDays };
