const fs = require("fs");
const path = require("path");

// Files created by Node and child processes such as ffmpeg must never be
// readable by other local users. systemd applies the same mask in production.
process.umask(0o077);

function loadEnvironment() {
  if (process.env.NODE_ENV === "test") return;

  require("dotenv").config({ quiet: true });
  if (process.env.NODE_ENV === "production") {
    require("dotenv").config({ path: ".env.prod", override: true, quiet: true });
  } else {
    require("dotenv").config({ path: ".env.local", override: true, quiet: true });
  }
}

loadEnvironment();

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const recordingsDir = path.join(rootDir, "recordings");
const artifactsDir = path.join(recordingsDir, "artifacts");
const recordingTmpDir = path.join(recordingsDir, "tmp");
const metadataFile = path.join(recordingsDir, "metadata.jsonl");
const leaderboardIdentitiesFile = path.join(recordingsDir, "leaderboard-identities.jsonl");
const questionsDir = path.join(rootDir, "questions");
const questionsMetadataFile = path.join(questionsDir, "metadata.jsonl");
const commentsDir = path.join(rootDir, "comments");
const commentsMetadataFile = path.join(commentsDir, "metadata.jsonl");
const consentsDir = path.join(rootDir, "consents");
const consentsMetadataFile = path.join(consentsDir, "metadata.jsonl");

for (const directory of [
  recordingsDir,
  artifactsDir,
  recordingTmpDir,
  questionsDir,
  commentsDir,
  consentsDir,
]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  rootDir,
  publicDir,
  recordingsDir,
  artifactsDir,
  recordingTmpDir,
  metadataFile,
  leaderboardIdentitiesFile,
  questionsMetadataFile,
  commentsMetadataFile,
  consentsMetadataFile,
  openApiFile: path.join(rootDir, "openapi.yaml"),
};
