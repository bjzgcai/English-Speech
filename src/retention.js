const fs = require("fs");
const path = require("path");
const { readJsonLines, updateJsonLines } = require("./storage");
const { userFigureFilenameFromSrc } = require("./user-figures");

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
  userFiguresDir,
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
    const finishedAt = Date.parse(record.finishedAt || record.startedAt || "");
    if (!Number.isFinite(finishedAt) || finishedAt > cutoff) continue;

    const hasVideo = Boolean(record?.filename) && isSafeName(record.filename);
    // A replacement figure can outlive the video reference (a failed or
    // no-video answer keeps the record but never stores a recording), so it is
    // expired on its own instead of only alongside a video.
    const figureFilename = userFiguresDir ? userFigureFilenameFromSrc(record?.question?.figure?.src) : null;
    if (!hasVideo && !figureFilename) continue;

    try {
      if (hasVideo) {
        if (isSafeName(record.id)) fs.rmSync(path.join(artifactsDir, record.id), { recursive: true, force: true });
        fs.rmSync(path.join(recordingsDir, record.filename), { force: true });
      }
      if (figureFilename) fs.rmSync(path.join(userFiguresDir, figureFilename), { force: true });
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
      if (!record) return record;
      if (!expiredKeys.has(record.id || `filename:${record.filename}`)) return record;
      changed = true;
      const next = { ...record };
      if (record.filename && isSafeName(record.filename)) {
        next.hasVideo = false;
        next.filename = null;
        next.mimeType = null;
        next.bytes = 0;
        next.recordingDeletedAt = now.toISOString();
        next.recordingDeletionReason = "retention";
      }
      if (userFiguresDir && userFigureFilenameFromSrc(record?.question?.figure?.src)) {
        next.question = { ...record.question, figure: null };
        next.figureDeletedAt = now.toISOString();
        next.figureDeletionReason = "retention";
      }
      return next;
    });
    return changed ? marked : current;
  });

  return { expired: expiredKeys.size, failed };
}

module.exports = { expireRecordings, parseRetentionDays };
