// One-off (2026-10-14): re-run every completed AI-detection with the new
// combined acoustic verdict. The heuristic-only verdicts (transcript + metrics
// + frames, no audio) are superseded: the omni model now hears the actual
// recording, and validated on 18 known-real pre-2026-09-15 clips it produced
// zero false positives where the heuristic produced two. Archives all current
// rows (completed and failed alike) to metadata.heuristic-2026-10-14.jsonl and
// drops them from metadata.jsonl; ensureTeacherDetections then re-enqueues
// every best answer automatically. Run ensureTeacherDetections() afterward.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const detectionsDir = process.argv[2] || "/opt/englisheval/shared/ai-detections";
const file = path.join(detectionsDir, "metadata.jsonl");
const archiveFile = path.join(detectionsDir, "metadata.heuristic-2026-10-14.jsonl");

const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => {
  try { return JSON.parse(line); } catch { throw new Error(`Unparsable row: ${line.slice(0, 100)}`); }
});
if (!rows.length) {
  console.log("No detection rows to requeue.");
  process.exit(0);
}
const stamp = new Date().toISOString();
fs.appendFileSync(archiveFile, rows.map(row => JSON.stringify({ ...row, archivedAt: stamp, archivedBy: "requeue-acoustic-detections-2026-10-14" })).join("\n") + "\n");
fs.writeFileSync(file + ".bak-" + stamp.replace(/[:.]/g, "-"), fs.readFileSync(file));
fs.writeFileSync(file, "");
console.log(`Archived ${rows.length} rows to ${archiveFile}; answers will be re-enqueued by ensureTeacherDetections().`);
