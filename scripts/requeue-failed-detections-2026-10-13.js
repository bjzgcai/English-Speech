// One-off (2026-10-13): the first AI-detection batch terminally failed 110 of
// 114 best answers with "The operation was aborted due to timeout" — the
// detection requests reused the 45s question-generation timeout and stampeded
// the internal gateway. The once-only suppression treats a failed row as
// analyzed, so those answers stay unflagged forever unless the rows are
// removed. This script archives every terminal `failed` row to
// metadata.failed-2026-10-13.jsonl and drops it from metadata.jsonl;
// ensureTeacherDetections then re-enqueues those answers automatically.
// Completed rows are left untouched (one-time analysis per answer).
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const detectionsDir = process.argv[2] || "/opt/englisheval/shared/ai-detections";
const file = path.join(detectionsDir, "metadata.jsonl");
const archiveFile = path.join(detectionsDir, "metadata.failed-2026-10-13.jsonl");

const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => {
  try { return JSON.parse(line); } catch { throw new Error(`Unparsable row: ${line.slice(0, 100)}`); }
});
const failed = rows.filter(row => row.state === "failed");
const kept = rows.filter(row => row.state !== "failed");
if (!failed.length) {
  console.log("No failed detection rows to requeue.");
  process.exit(0);
}
const stamp = new Date().toISOString();
fs.appendFileSync(archiveFile, failed.map(row => JSON.stringify({ ...row, archivedAt: stamp, archivedBy: "requeue-failed-detections-2026-10-13" })).join("\n") + "\n");
fs.writeFileSync(file + ".bak-" + stamp.replace(/[:.]/g, "-"), fs.readFileSync(file));
fs.writeFileSync(file, kept.map(row => JSON.stringify(row)).join("\n") + "\n");
console.log(`Archived and removed ${failed.length} failed rows (kept ${kept.length}); answers will be re-enqueued on the next teacher-page hit or worker tick.`);
