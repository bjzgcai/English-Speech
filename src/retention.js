const fs = require("fs");
const path = require("path");
const { readJsonLines, writeJsonLines } = require("./storage");

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
  let expired = 0;
  let failed = 0;
  let changed = false;
  const records = readJsonLines(metadataFile);
  const updatedRecords = records.map((record) => {
    if (!record?.filename || !isSafeName(record.filename)) return record;

    const finishedAt = Date.parse(record.finishedAt || record.startedAt || "");
    if (!Number.isFinite(finishedAt) || finishedAt > cutoff) return record;

    const videoPath = path.join(recordingsDir, record.filename);
    const artifactPath = isSafeName(record.id) ? path.join(artifactsDir, record.id) : null;

    try {
      if (artifactPath) fs.rmSync(artifactPath, { recursive: true, force: true });
      fs.rmSync(videoPath, { force: true });
    } catch (error) {
      failed += 1;
      console.error(`Unable to expire recording ${record.id || "unknown"}: ${error.message}`);
      return record;
    }

    expired += 1;
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

  if (changed) writeJsonLines(metadataFile, updatedRecords);
  return { expired, failed };
}

module.exports = { expireRecordings, parseRetentionDays };
