#!/usr/bin/env node

// Sweeps crash-orphaned upload and rewrite leftovers that no request path
// cleans up: pending uploads whose job never got accepted (web crash between
// multer rename and queue.accept, or an upload abandoned mid-transfer), and
// stale updateJsonLines temp files. Production had 129 MB of pending files
// orphaned in a single day; without this they accumulate forever.

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

process.umask(0o077);

const rootDir = process.env.APP_ROOT || path.resolve(__dirname, "..");
const recordingsDir = process.env.RECORDINGS_DIR || path.join(rootDir, "recordings");
const pendingDir = path.join(recordingsDir, "pending");
const metadataFile = path.join(recordingsDir, "metadata.jsonl");
const queueFile = path.join(recordingsDir, "queue.sqlite");
const maxAgeMs = 24 * 3600 * 1000;
const now = Date.now();

// A pending file is named "<submissionId>-<uploadUuid>"; its first five
// hyphen-separated segments reassemble the submission UUID. The file is live
// while that submission still has a queue job, a cancellation tombstone, or a
// metadata record; anything older than the grace period is garbage.
function knownSubmissionIds() {
  const known = new Set();
  if (fs.existsSync(metadataFile)) {
    for (const line of fs.readFileSync(metadataFile, "utf8").split("\n")) {
      if (!line) continue;
      try { known.add(JSON.parse(line).id); } catch { /* torn line */ }
    }
  }
  // The maintenance window already stops the web service and worker, so the
  // database is idle; open read-only regardless to touch nothing.
  let db = null;
  try { db = fs.existsSync(queueFile) ? new DatabaseSync(queueFile, { readOnly: true }) : null; }
  catch { /* a missing or locked database means "no queue evidence" */ }
  if (db) {
    try {
      for (const row of db.prepare("SELECT id FROM jobs").all()) known.add(row.id);
      for (const row of db.prepare("SELECT id FROM cancellations").all()) known.add(row.id);
    } catch { /* tolerate an older schema without cancellations */ }
    db.close();
  }
  return known;
}

function sweepPending() {
  if (!fs.existsSync(pendingDir)) return { removed: 0, bytes: 0 };
  const known = knownSubmissionIds();
  let removed = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(pendingDir)) {
    const full = path.join(pendingDir, entry);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (now - stat.mtimeMs < maxAgeMs) continue;
    const submissionId = entry.split("-").slice(0, 5).join("-");
    if (known.has(submissionId)) continue;
    try {
      fs.rmSync(full, { force: true });
      removed += 1;
      bytes += stat.size;
    } catch { /* in-flight rename; the next run retries */ }
  }
  return { removed, bytes };
}

// <file>.<pid>.tmp files come from interrupted updateJsonLines rewrites.
function sweepTempRewrites() {
  let removed = 0;
  let bytes = 0;
  for (const dir of [recordingsDir, path.join(rootDir, "questions")]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".tmp")) continue;
      const full = path.join(dir, entry);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (now - stat.mtimeMs < maxAgeMs) continue;
      try {
        fs.rmSync(full, { force: true });
        removed += 1;
        bytes += stat.size;
      } catch { /* the next run retries */ }
    }
  }
  return { removed, bytes };
}

const pending = sweepPending();
const temps = sweepTempRewrites();
console.log(
  `Storage sweep complete: pendingRemoved=${pending.removed} tempRemoved=${temps.removed} ` +
  `bytes=${pending.bytes + temps.bytes}`
);
