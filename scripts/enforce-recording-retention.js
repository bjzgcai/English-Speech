#!/usr/bin/env node

const path = require("path");
const { expireRecordings, parseRetentionDays } = require("../src/retention");

process.umask(0o077);

const rootDir = process.env.APP_ROOT || path.resolve(__dirname, "..");
const recordingsDir = process.env.RECORDINGS_DIR || path.join(rootDir, "recordings");
const artifactsDir = path.join(recordingsDir, "artifacts");
const metadataFile = path.join(recordingsDir, "metadata.jsonl");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : rootDir;
const userFiguresDir = path.join(dataDir, "user-figures");

const retentionDays = parseRetentionDays(process.env.RECORDING_RETENTION_DAYS);
if (!retentionDays) {
  console.log("Recording retention disabled: live recordings are preserved indefinitely.");
  process.exit(0);
}

const result = expireRecordings({
  artifactsDir,
  metadataFile,
  recordingsDir,
  retentionDays,
  userFiguresDir,
});

console.log(`Recording retention complete: expired=${result.expired} failed=${result.failed}`);
if (result.failed) process.exitCode = 1;
