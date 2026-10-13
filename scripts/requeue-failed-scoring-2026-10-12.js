// One-off: requeue failed scoring jobs so the worker re-evaluates them.
// Keeps the normalization/transcription checkpoints (no re-upload needed) but
// drops the cached scoring response and its retry budget, because a cached
// HTTP-200 runaway response would replay the identical failure.
// projected=1 keeps the history placeholder untouched while queued; worker's
// finish() resets it to 0 so the completed result replaces the failed record.
// A job whose media is gone (owner deleted the answer, or the terminal
// projection removed the pending upload) is SKIPPED: requeueing it would make
// the worker hard-fail with "could not be processed as supported media" and
// resurrect a deleted record with bytes=0.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const recordingsDir = "/opt/englisheval/shared/recordings";

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("usage: node requeue-failed-scoring-2026-10-12.js <jobId> [...]");
  process.exit(2);
}

const db = new DatabaseSync("/opt/englisheval/shared/recordings/queue.sqlite");
db.exec("BEGIN");
try {
  const update = db.prepare(
    "UPDATE jobs SET state='queued', stage='scoring', token=NULL, lease=NULL, retry_at=NULL, recovery_count=0, projected=1, updated=?, checkpoint=? WHERE id=? AND state='failed'",
  );
  for (const id of ids) {
    const job = db.prepare("SELECT state, payload, checkpoint FROM jobs WHERE id=?").get(id);
    if (!job) throw new Error(`${id}: job not found`);
    if (job.state !== "failed") throw new Error(`${id}: state is ${job.state}, expected failed`);
    const payload = JSON.parse(job.payload);
    const checkpoint = JSON.parse(job.checkpoint);
    const videoPath = payload.record?.filename ? path.join(recordingsDir, payload.record.filename) : null;
    const inputPath = payload.inputPath || null;
    // A normalized file is only rebuildable from the original upload; once the
    // upload is consumed the checkpoint's normalized flag is the only path.
    const hasMedia = checkpoint.normalized
      ? Boolean(videoPath && fs.existsSync(videoPath))
      : Boolean(inputPath && fs.existsSync(inputPath));
    if (!hasMedia) {
      console.error(`skipped ${id}: media missing (video=${videoPath || "none"} exists=${videoPath ? fs.existsSync(videoPath) : false}, input=${inputPath || "none"} exists=${inputPath ? fs.existsSync(inputPath) : false})`);
      continue;
    }
    const cacheKeys = Object.keys(checkpoint.network || {});
    delete checkpoint.network?.scoring;
    update.run(Date.now(), JSON.stringify(checkpoint), id);
    db.prepare("DELETE FROM attempts WHERE job=? AND key='scoring'").run(id);
    console.log(`requeued ${id} (dropped cached scoring; kept: ${cacheKeys.filter((k) => k !== "scoring").join(", ") || "none"})`);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  console.error(error.message);
  process.exit(1);
}
