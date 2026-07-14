const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { expireRecordings, parseRetentionDays } = require("../src/retention");
const { readJsonLines, writeJsonLines } = require("../src/storage");

test("retention setting accepts disabled and positive day counts", () => {
  assert.equal(parseRetentionDays(undefined), 0);
  assert.equal(parseRetentionDays("0"), 0);
  assert.equal(parseRetentionDays("90"), 90);
  assert.throws(() => parseRetentionDays("1.5"), /non-negative integer/);
  assert.throws(() => parseRetentionDays("-1"), /non-negative integer/);
});

test("expired videos and artifacts are removed while evaluation history remains", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-retention-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const recordingsDir = path.join(root, "recordings");
  const artifactsDir = path.join(recordingsDir, "artifacts");
  const metadataFile = path.join(recordingsDir, "metadata.jsonl");
  fs.mkdirSync(path.join(artifactsDir, "old-id"), { recursive: true });
  fs.writeFileSync(path.join(recordingsDir, "old.mp4"), "old");
  fs.writeFileSync(path.join(artifactsDir, "old-id", "transcript.txt"), "text");
  fs.writeFileSync(path.join(recordingsDir, "new.mp4"), "new");
  writeJsonLines(metadataFile, [
    {
      id: "old-id",
      hasVideo: true,
      filename: "old.mp4",
      mimeType: "video/mp4",
      bytes: 3,
      finishedAt: "2026-01-01T00:00:00.000Z",
      evaluation: { status: "complete", overallScore: 88 },
    },
    {
      id: "new-id",
      hasVideo: true,
      filename: "new.mp4",
      finishedAt: "2026-06-15T00:00:00.000Z",
    },
  ]);

  const result = expireRecordings({
    artifactsDir,
    metadataFile,
    now: new Date("2026-07-14T00:00:00.000Z"),
    recordingsDir,
    retentionDays: 90,
  });

  assert.deepEqual(result, { expired: 1, failed: 0 });
  assert.equal(fs.existsSync(path.join(recordingsDir, "old.mp4")), false);
  assert.equal(fs.existsSync(path.join(artifactsDir, "old-id")), false);
  assert.equal(fs.existsSync(path.join(recordingsDir, "new.mp4")), true);
  const [oldRecord, newRecord] = readJsonLines(metadataFile);
  assert.equal(oldRecord.hasVideo, false);
  assert.equal(oldRecord.filename, null);
  assert.equal(oldRecord.evaluation.overallScore, 88);
  assert.equal(oldRecord.recordingDeletionReason, "retention");
  assert.equal(newRecord.filename, "new.mp4");
});

test("disabled retention leaves recordings untouched", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-retention-disabled-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const recordingsDir = path.join(root, "recordings");
  const artifactsDir = path.join(recordingsDir, "artifacts");
  const metadataFile = path.join(recordingsDir, "metadata.jsonl");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(recordingsDir, "old.mp4"), "old");
  writeJsonLines(metadataFile, [{ filename: "old.mp4", finishedAt: "2020-01-01T00:00:00Z" }]);

  assert.deepEqual(
    expireRecordings({ artifactsDir, metadataFile, recordingsDir, retentionDays: 0 }),
    { expired: 0, failed: 0 },
  );
  assert.equal(fs.existsSync(path.join(recordingsDir, "old.mp4")), true);
});
